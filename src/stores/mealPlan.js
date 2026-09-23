import { defineStore } from 'pinia'
import { read, write } from '@/utils/storage'
import { uid } from '@/utils/id'
import { currentWeekKey } from '@/utils/date'
import { WEEK_DAYS, MEALS } from '@/constants'

const DISH_KEY = 'dishes'
const PLAN_KEY = 'plan'
const AUTO_KEY = 'autoFilled'

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
    // 自动排菜标记：结构与 plan 相同，仅记录由 autoFillWeek 填入的菜品 id
    autoFilled: read(AUTO_KEY, {}),
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
    persistAuto() {
      write(AUTO_KEY, this.autoFilled)
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
      // 从所有计划及自动排菜标记中移除引用
      Object.values(this.plan).forEach((week) => {
        WEEK_DAYS.forEach((d) => {
          MEALS.forEach((m) => {
            const k = mealKey(m)
            week[d.key][k] = week[d.key][k].filter((dishId) => dishId !== id)
          })
        })
      })
      Object.values(this.autoFilled).forEach((week) => {
        WEEK_DAYS.forEach((d) => {
          MEALS.forEach((m) => {
            const k = mealKey(m)
            week[d.key][k] = week[d.key][k].filter((dishId) => dishId !== id)
          })
        })
      })
      this.persistDishes()
      this.persistPlan()
      this.persistAuto()
    },

    // 将菜品安排到某餐次（存在则移除，实现切换）
    toggleDish(weekKey, dayKey, meal, dishId) {
      const week = this.plan[weekKey] || (this.plan[weekKey] = emptyWeek())
      const k = mealKey(meal)
      const slot = week[dayKey][k]
      const idx = slot.indexOf(dishId)
      if (idx === -1) {
        slot.push(dishId)
      } else {
        slot.splice(idx, 1)
        // 手动移除时同步清除自动标记（手动加入的菜本身不会有标记）
        const autoWeek = this.autoFilled[weekKey]
        if (autoWeek) {
          autoWeek[dayKey][k] = autoWeek[dayKey][k].filter((x) => x !== dishId)
          this.persistAuto()
        }
      }
      this.persistPlan()
    },

    clearSlot(weekKey, dayKey, meal) {
      const week = this.plan[weekKey]
      if (!week) return
      const k = mealKey(meal)
      week[dayKey][k] = []
      const autoWeek = this.autoFilled[weekKey]
      if (autoWeek && autoWeek[dayKey][k].length) {
        autoWeek[dayKey][k] = []
        this.persistAuto()
      }
      this.persistPlan()
    },

    // 自动排菜：为一周内所有空闲餐次随机填入菜品，尽量不重复；已安排的餐次保持不动
    // 返回新填入的餐次数
    autoFillWeek(weekKey) {
      const allIds = this.dishes.map((d) => d.id)
      if (!allIds.length) return 0

      const week = this.plan[weekKey] || (this.plan[weekKey] = emptyWeek())
      const autoWeek = this.autoFilled[weekKey] || (this.autoFilled[weekKey] = emptyWeek())

      // 已有菜品使用次数（整周加权），优先选出现次数少的
      const usedCount = {}
      WEEK_DAYS.forEach((d) => {
        MEALS.forEach((m) => {
          week[d.key][mealKey(m)].forEach((dishId) => {
            usedCount[dishId] = (usedCount[dishId] || 0) + 1
          })
        })
      })
      allIds.forEach((id) => (usedCount[id] = usedCount[id] || 0))

      let filled = 0
      WEEK_DAYS.forEach((d) => {
        MEALS.forEach((m) => {
          const k = mealKey(m)
          // 只填空闲餐次，手动排好的不动
          if (week[d.key][k].length > 0) return

          // 当天已出现的菜再降权，进一步降低重复感
          const dayIds = new Set()
          MEALS.forEach((other) =>
            week[d.key][mealKey(other)].forEach((id) => dayIds.add(id)),
          )

          const minCount = Math.min(
            ...allIds.map((id) => usedCount[id] + (dayIds.has(id) ? 1 : 0)),
          )
          const candidates = allIds.filter(
            (id) => usedCount[id] + (dayIds.has(id) ? 1 : 0) === minCount,
          )
          const picked = candidates[Math.floor(Math.random() * candidates.length)]

          week[d.key][k] = [picked]
          autoWeek[d.key][k] = [picked]
          usedCount[picked] += 1
          filled += 1
        })
      })

      this.persistPlan()
      this.persistAuto()
      return filled
    },

    // 清空自动排菜结果：仅移除 autoFilled 标记对应的菜品，手动安排的保持不动
    // 返回清空的餐次数
    clearAutoFilled(weekKey) {
      const autoWeek = this.autoFilled[weekKey]
      const week = this.plan[weekKey]
      if (!autoWeek || !week) return 0

      let cleared = 0
      WEEK_DAYS.forEach((d) => {
        MEALS.forEach((m) => {
          const k = mealKey(m)
          const autoIds = autoWeek[d.key][k]
          if (!autoIds || !autoIds.length) return
          week[d.key][k] = week[d.key][k].filter((dishId) => !autoIds.includes(dishId))
          autoWeek[d.key][k] = []
          cleared += 1
        })
      })

      this.persistPlan()
      this.persistAuto()
      return cleared
    },
  },
})

function mealKey(meal) {
  return { 早餐: 'breakfast', 午餐: 'lunch', 晚餐: 'dinner' }[meal] || meal
}
