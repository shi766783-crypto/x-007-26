import { defineStore } from 'pinia'
import { read, write } from '@/utils/storage'
import { uid } from '@/utils/id'
import { currentWeekKey } from '@/utils/date'
import { WEEK_DAYS, MEALS } from '@/constants'

const DISH_KEY = 'dishes'
const PLAN_KEY = 'plan'
const AUTO_SLOTS_KEY = 'autoSlots'

function slotId(dayKey, mealKey) {
  return `${dayKey}:${mealKey}`
}

function createDish(data) {
  return {
    id: uid('dish'),
    name: '',
    category: '蔬菜',
    ingredients: [], // [{ ingredientId|null, name, quantity, unit }]
    instructions: '',
    cookTime: 15,
    difficulty: '简单',
    publishedAt: new Date().toISOString(),
    ...data,
  }
}

function emptyWeek() {
  const days = {}
  WEEK_DAYS.forEach((d) => {
    days[d.key] = { breakfast: [], lunch: [], dinner: [] }
  })
  return days
}

export const useMealPlanStore = defineStore('mealPlan', {
  state: () => ({
    dishes: read(DISH_KEY, []),
    // { [weekKey]: { [dayKey]: { breakfast: [], lunch: [], dinner: [] } } }
    plan: read(PLAN_KEY, {}),
    // 自动排菜标记：{ [weekKey]: ['monday:breakfast', ...] }
    // 只有自动填入且用户未手动改动过的餐次才会保留标记
    autoSlots: read(AUTO_SLOTS_KEY, {}),
  }),

  getters: {
    totalDishes: (state) => state.dishes.length,

    // 当前周计划（只读，缺省返回空结构，不产生副作用）
    currentWeek() {
      const key = currentWeekKey()
      return { key, days: this.plan[key] || emptyWeek() }
    },

    // 已安排菜品的餐次数量
    plannedMeals() {
      const { days } = this.currentWeek
      let count = 0
      WEEK_DAYS.forEach((d) => {
        MEALS.forEach((m) => {
          const key = mealKey(m)
          if (days[d.key][key].length > 0) count++
        })
      })
      return count
    },

    // 菜品 id -> 对象映射
    dishMap() {
      const map = {}
      this.dishes.forEach((d) => (map[d.id] = d))
      return map
    },

    // 某周某餐次是否为自动排菜，用法：isAutoSlot(weekKey, dayKey, mealKey)
    isAutoSlot() {
      return (weekKey, dayKey, mealKey) => {
        const list = this.autoSlots[weekKey]
        return Array.isArray(list) && list.includes(slotId(dayKey, mealKey))
      }
    },

    // 某周自动排菜餐次数
    autoSlotCount() {
      return (weekKey) => (this.autoSlots[weekKey] || []).length
    },

    // 本周所需食材总量（按名称+单位聚合）
    weeklyRequirements() {
      const agg = {} // key: `${name}|${unit}`
      const dishMap = this.dishMap
      const { days } = this.currentWeek
      WEEK_DAYS.forEach((d) => {
        MEALS.forEach((m) => {
          days[d.key][mealKey(m)].forEach((dishId) => {
            const dish = dishMap[dishId]
            if (!dish) return
            dish.ingredients.forEach((ing) => {
              const key = `${ing.name}|${ing.unit}`
              if (!agg[key]) {
                agg[key] = {
                  name: ing.name,
                  unit: ing.unit,
                  ingredientId: ing.ingredientId || null,
                  required: 0,
                }
              }
              agg[key].required += Number(ing.quantity || 0)
            })
          })
        })
      })
      return Object.values(agg)
    },

    // 本周涉及菜品的营养类别占比
    weekDishCategories() {
      const dishMap = this.dishMap
      const cats = []
      const { days } = this.currentWeek
      WEEK_DAYS.forEach((d) => {
        MEALS.forEach((m) => {
          days[d.key][mealKey(m)].forEach((dishId) => {
            const dish = dishMap[dishId]
            if (dish) cats.push(dish.category)
          })
        })
      })
      return cats
    },
  },

  actions: {
    persistDishes() {
      write(DISH_KEY, this.dishes)
    },
    persistPlan() {
      write(PLAN_KEY, this.plan)
    },
    persistAutoSlots() {
      write(AUTO_SLOTS_KEY, this.autoSlots)
    },

    addDish(data) {
      const dish = createDish(data)
      this.dishes.unshift(dish)
      this.persistDishes()
      return dish
    },

    updateDish(id, patch) {
      const idx = this.dishes.findIndex((d) => d.id === id)
      if (idx === -1) return
      this.dishes[idx] = { ...this.dishes[idx], ...patch }
      this.persistDishes()
    },

    removeDish(id) {
      this.dishes = this.dishes.filter((d) => d.id !== id)
      // 从所有计划中移除引用，并清理因此变空的自动排菜标记
      Object.entries(this.plan).forEach(([wk, week]) => {
        WEEK_DAYS.forEach((d) => {
          MEALS.forEach((m) => {
            const k = mealKey(m)
            week[d.key][k] = week[d.key][k].filter((dishId) => dishId !== id)
            if (week[d.key][k].length === 0) this.unmarkAutoSlot(wk, d.key, k, false)
          })
        })
      })
      this.persistDishes()
      this.persistPlan()
      this.persistAutoSlots()
    },

    // 将菜品安排到某餐次（存在则移除，实现切换）。手动操作会把该餐次的自动标记摘掉
    toggleDish(weekKey, dayKey, meal, dishId) {
      const week = this.plan[weekKey] || (this.plan[weekKey] = emptyWeek())
      const k = mealKey(meal)
      const slot = week[dayKey][k]
      const idx = slot.indexOf(dishId)
      if (idx === -1) slot.push(dishId)
      else slot.splice(idx, 1)
      this.unmarkAutoSlot(weekKey, dayKey, k)
      this.persistPlan()
      this.persistAutoSlots()
    },

    clearSlot(weekKey, dayKey, meal) {
      const week = this.plan[weekKey]
      if (!week) return
      const k = mealKey(meal)
      week[dayKey][k] = []
      this.unmarkAutoSlot(weekKey, dayKey, k)
      this.persistPlan()
      this.persistAutoSlots()
    },

    // 标记 / 取消标记自动排菜餐次
    unmarkAutoSlot(weekKey, dayKey, k, persist = true) {
      const list = this.autoSlots[weekKey]
      if (!Array.isArray(list)) return
      const next = list.filter((sid) => sid !== slotId(dayKey, k))
      if (next.length === 0) delete this.autoSlots[weekKey]
      else if (next.length !== list.length) this.autoSlots[weekKey] = next
      if (persist) this.persistAutoSlots()
    },

    // 一键自动排菜：只为空闲餐次随机填入菜品，已有内容（含手动安排）一律不动。
    // 选菜策略：优先选择本周出现次数最少的菜品，其次避开同一天已出现的菜品，
    // 候选集合随机打散，在尽量不重复的前提下兼顾随机感。
    // 返回新填入的餐次数量。
    autoFillWeek(weekKey) {
      if (this.dishes.length === 0) return 0
      const week = this.plan[weekKey] || (this.plan[weekKey] = emptyWeek())
      const autoSet = new Set(this.autoSlots[weekKey] || [])

      // 统计当前每道菜的使用次数、以及各天已用菜品
      const usage = {}
      const dayUsed = {}
      WEEK_DAYS.forEach((d) => {
        const set = new Set()
        MEALS.forEach((m) => {
          const k = mealKey(m)
          week[d.key][k].forEach((dishId) => {
            usage[dishId] = (usage[dishId] || 0) + 1
            set.add(dishId)
          })
        })
        dayUsed[d.key] = set
      })

      // 收集空闲餐次并随机打乱填充顺序
      const empties = []
      WEEK_DAYS.forEach((d) => {
        MEALS.forEach((m) => {
          const k = mealKey(m)
          if (week[d.key][k].length === 0) empties.push({ day: d.key, meal: k })
        })
      })
      shuffle(empties)

      const allIds = this.dishes.map((d) => d.id)
      let filled = 0
      empties.forEach(({ day, meal }) => {
        const usedToday = dayUsed[day]
        // 分数越小越优先：先按全局使用次数，再按"同一天是否已出现"
        const scored = shuffle(allIds.slice()).map((id) => ({
          id,
          score: (usage[id] || 0) * 2 + (usedToday.has(id) ? 1 : 0),
        }))
        scored.sort((a, b) => a.score - b.score)
        const pick = scored[0].id

        week[day][meal] = [pick]
        usage[pick] = (usage[pick] || 0) + 1
        usedToday.add(pick)
        autoSet.add(slotId(day, meal))
        filled += 1
      })

      if (filled > 0) {
        this.autoSlots[weekKey] = [...autoSet]
        this.persistPlan()
        this.persistAutoSlots()
      }
      return filled
    },

    // 清空本周自动排菜填入的餐次，手动安排的餐次保持不动。返回清空数量
    clearAutoSlots(weekKey) {
      const list = this.autoSlots[weekKey]
      if (!Array.isArray(list) || list.length === 0) return 0
      const week = this.plan[weekKey]
      let cleared = 0
      list.forEach((sid) => {
        const [day, k] = sid.split(':')
        if (week && week[day]) {
          week[day][k] = []
          cleared += 1
        }
      })
      delete this.autoSlots[weekKey]
      this.persistPlan()
      this.persistAutoSlots()
      return cleared
    },

    // 一键清空自动部分并重排，返回新填入的餐次数量
    reshuffleWeek(weekKey) {
      this.clearAutoSlots(weekKey)
      return this.autoFillWeek(weekKey)
    },
  },
})

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function mealKey(meal) {
  return { 早餐: 'breakfast', 午餐: 'lunch', 晚餐: 'dinner' }[meal] || meal
}
