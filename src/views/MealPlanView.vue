<script setup>
import { ref, computed } from 'vue'
import { useMealPlanStore } from '@/stores/mealPlan'
import { WEEK_DAYS, MEALS, MEAL_ICONS, DIFFICULTY_COLORS } from '@/constants'
import { currentWeekKey, toWeekKey, parseDateKey, weekStartFromKey, currentWeekStart } from '@/utils/date'
import DishForm from '@/components/mealplan/DishForm.vue'
import BaseModal from '@/components/common/BaseModal.vue'
import BaseButton from '@/components/common/BaseButton.vue'
import BaseTag from '@/components/common/BaseTag.vue'
import BaseEmpty from '@/components/common/BaseEmpty.vue'

const mealPlan = useMealPlanStore()

const MEAL_KEY_MAP = { 早餐: 'breakfast', 午餐: 'lunch', 晚餐: 'dinner' }

const weekKey = ref(currentWeekKey())
const showSlotPicker = ref(false)
const showDishForm = ref(false)
const showLibrary = ref(false)
const editingDish = ref(null)
const slotTarget = ref({ day: 'monday', meal: '早餐' })
const search = ref('')
const notice = ref(null) // { type: 'info' | 'warn', text }

const weekDays = computed(() => mealPlan.plan[weekKey.value] || {})
const weekLabel = computed(() => {
  const start = weekStartFromKey(weekKey.value)
  const d = parseDateKey(start)
  return `${d.getMonth() + 1}月${d.getDate()}日 起`
})

const autoCount = computed(() => mealPlan.autoSlotCount(weekKey.value))

const emptyCount = computed(() => {
  let count = 0
  WEEK_DAYS.forEach((d) => {
    MEALS.forEach((m) => {
      if (mealSlot(d.key, m).length === 0) count += 1
    })
  })
  return count
})

const filteredDishes = computed(() => {
  const q = search.value.trim()
  if (!q) return mealPlan.dishes
  return mealPlan.dishes.filter((d) => d.name.includes(q))
})

function shiftWeek(delta) {
  const start = parseDateKey(weekStartFromKey(weekKey.value))
  start.setDate(start.getDate() + delta * 7)
  weekKey.value = toWeekKey(start)
  notice.value = null
}

function goCurrentWeek() {
  weekKey.value = currentWeekKey()
  notice.value = null
}

// 一键自动排菜：随机填满空闲餐次，已手动安排的不动
function autoFill() {
  if (!mealPlan.dishes.length) {
    notice.value = { type: 'warn', text: '菜谱库还是空的，先新建几道菜品再来自动排菜吧' }
    return
  }
  if (emptyCount.value === 0) {
    notice.value = { type: 'info', text: '本周 21 个餐次都已排满，无需自动排菜' }
    return
  }
  const filled = mealPlan.autoFillWeek(weekKey.value)
  notice.value = { type: 'info', text: `已自动填入 ${filled} 个空闲餐次，手动安排的保持不变` }
}

// 一键清空自动填入的餐次后重新随机排菜
function reshuffle() {
  if (!mealPlan.dishes.length) {
    notice.value = { type: 'warn', text: '菜谱库还是空的，先新建几道菜品再来自动排菜吧' }
    return
  }
  const removed = autoCount.value
  const filled = mealPlan.reshuffleWeek(weekKey.value)
  notice.value = {
    type: 'info',
    text: removed
      ? `已清空 ${removed} 个自动餐次并重新填入 ${filled} 个，手动安排的保持不变`
      : `已自动填入 ${filled} 个空闲餐次，手动安排的保持不变`,
  }
}

// 只清空自动排菜的部分
function clearAuto() {
  const cleared = mealPlan.clearAutoSlots(weekKey.value)
  notice.value = { type: 'info', text: `已清空 ${cleared} 个自动排菜餐次，手动安排的未受影响` }
}

function openPicker(day, meal) {
  slotTarget.value = { day, meal }
  showSlotPicker.value = true
}

function pickDish(dishId) {
  mealPlan.toggleDish(weekKey.value, slotTarget.value.day, slotTarget.value.meal, dishId)
}

function removeDish(day, meal, dishId) {
  mealPlan.toggleDish(weekKey.value, day, meal, dishId)
}

function openNewDish() {
  editingDish.value = null
  showDishForm.value = true
}

function openEditDish(dish) {
  editingDish.value = dish
  showDishForm.value = true
}

function onDishSave(data) {
  if (editingDish.value) mealPlan.updateDish(editingDish.value.id, data)
  else mealPlan.addDish(data)
  showDishForm.value = false
}

function mealSlot(day, meal) {
  const m = MEAL_KEY_MAP[meal]
  return (weekDays.value[day] && weekDays.value[day][m]) || []
}

function isAuto(day, meal) {
  return mealPlan.isAutoSlot(weekKey.value, day, MEAL_KEY_MAP[meal])
}
</script>

<template>
  <div>
    <div class="page-head">
      <h2>📅 每周食谱计划</h2>
      <div class="head-actions">
        <BaseButton variant="ghost" size="sm" @click="showLibrary = true">我的菜谱（{{ mealPlan.dishes.length }}）</BaseButton>
        <BaseButton size="sm" @click="openNewDish">+ 新建菜品</BaseButton>
      </div>
    </div>

    <div class="week-nav card">
      <BaseButton variant="ghost" size="sm" @click="shiftWeek(-1)">‹ 上周</BaseButton>
      <div class="week-label">
        <span class="week-title">{{ weekKey }}</span>
        <span class="muted small">{{ weekLabel }}</span>
      </div>
      <BaseButton variant="ghost" size="sm" @click="shiftWeek(1)">下周 ›</BaseButton>
      <BaseButton variant="text" size="sm" @click="goCurrentWeek">回到本周</BaseButton>
      <span class="nav-divider"></span>
      <BaseButton
        v-if="autoCount === 0"
        size="sm"
        :disabled="!mealPlan.dishes.length"
        @click="autoFill"
      >🎲 自动排菜</BaseButton>
      <template v-else>
        <BaseButton size="sm" @click="reshuffle">🔄 换一批</BaseButton>
        <BaseButton variant="text" size="sm" @click="clearAuto">撤销</BaseButton>
      </template>
    </div>

    <div v-if="notice" class="notice-bar" :class="`notice--${notice.type}`">
      <span>{{ notice.type === 'warn' ? '⚠️' : '✨' }} {{ notice.text }}</span>
      <button class="notice-close" @click="notice = null">✕</button>
    </div>
    <div v-else-if="autoCount > 0" class="notice-bar notice--info">
      <span>🎲 已自动排 {{ autoCount }} 餐<span v-if="emptyCount">，空闲 {{ emptyCount }} 餐</span>；带 ✨ 的为自动填入，可点「换一批」重排或「撤销」清空</span>
      <button class="notice-close" @click="notice = null">✕</button>
    </div>

    <div class="plan-board">
      <div class="plan-header">
        <div class="corner"></div>
        <div v-for="d in WEEK_DAYS" :key="d.key" class="day-head">{{ d.label }}</div>
      </div>
      <div v-for="meal in MEALS" :key="meal" class="plan-row">
        <div class="meal-label">
          {{ MEAL_ICONS[meal] }} {{ meal }}
        </div>
        <div
          v-for="d in WEEK_DAYS"
          :key="d.key"
          class="slot"
          :class="{ 'slot--auto': isAuto(d.key, meal) }"
        >
          <div v-for="dishId in mealSlot(d.key, meal)" :key="dishId" class="dish-chip">
            <BaseTag
              :text="`${isAuto(d.key, meal) ? '✨ ' : ''}${mealPlan.dishMap[dishId]?.name || '未知'}`"
              :color="DIFFICULTY_COLORS[mealPlan.dishMap[dishId]?.difficulty] || '#90a4ae'"
            />
            <button class="rm" @click="removeDish(d.key, meal, dishId)">✕</button>
          </div>
          <button class="add-slot" @click="openPicker(d.key, meal)">+</button>
        </div>
      </div>
    </div>

    <!-- 菜品选择 -->
    <BaseModal :show="showSlotPicker" :title="`为 ${slotTarget.meal} 选择菜品`" @close="showSlotPicker = false">
      <div class="picker-search">
        <input v-model="search" type="text" placeholder="搜索菜品…" />
        <BaseButton size="sm" variant="ghost" @click="openNewDish">+ 新建</BaseButton>
      </div>
      <BaseEmpty v-if="!filteredDishes.length" emoji="🍲" text="还没有菜谱，先新建一道菜吧" />
      <div v-else class="dish-list">
        <div v-for="dish in filteredDishes" :key="dish.id" class="dish-row">
          <div class="dish-info">
            <span class="dish-name">{{ dish.name }}</span>
            <span class="muted small">{{ dish.ingredients.length }} 种食材 · {{ dish.cookTime }}分钟</span>
          </div>
          <BaseButton size="sm" @click="pickDish(dish.id)">加入</BaseButton>
        </div>
      </div>
    </BaseModal>

    <!-- 菜谱库 -->
    <BaseModal :show="showLibrary" title="我的菜谱库" width="640px" @close="showLibrary = false">
      <BaseEmpty v-if="!mealPlan.dishes.length" emoji="📖" text="暂无菜谱" />
      <div v-else class="library">
        <div v-for="dish in mealPlan.dishes" :key="dish.id" class="lib-item">
          <div class="lib-head">
            <span class="dish-name">{{ dish.name }}</span>
            <BaseTag :category="dish.category" :text="dish.category" />
          </div>
          <div class="muted small">
            {{ dish.ingredients.map((i) => i.name).join('、') || '无食材' }} · {{ dish.cookTime }}分钟 · {{ dish.difficulty }}
          </div>
          <div v-if="dish.instructions" class="muted small instr">{{ dish.instructions }}</div>
          <div class="lib-actions">
            <BaseButton size="sm" variant="ghost" @click="openEditDish(dish)">编辑</BaseButton>
            <BaseButton size="sm" variant="text" @click="mealPlan.removeDish(dish.id)">删除</BaseButton>
          </div>
        </div>
      </div>
    </BaseModal>

    <!-- 菜品表单 -->
    <BaseModal :show="showDishForm" :title="editingDish ? '编辑菜品' : '新建菜品'" width="640px" @close="showDishForm = false">
      <DishForm :initial="editingDish" @submit="onDishSave" @cancel="showDishForm = false" />
    </BaseModal>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.page-head h2 {
  margin: 0;
}
.head-actions {
  display: flex;
  gap: 8px;
}
.week-nav {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.nav-divider {
  width: 1px;
  height: 20px;
  background: var(--border);
}
.notice-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 13px;
  margin-bottom: 12px;
}
.notice--info {
  background: var(--primary-light);
  color: var(--primary-dark);
}
.notice--warn {
  background: var(--warn-light);
  color: #e65100;
}
.notice-close {
  border: none;
  background: none;
  color: inherit;
  opacity: 0.6;
  cursor: pointer;
  font-size: 12px;
}
.notice-close:hover {
  opacity: 1;
}
.week-label {
  flex: 1;
  text-align: center;
}
.week-title {
  font-weight: 700;
  font-size: 16px;
}
.small {
  font-size: 12px;
}
.plan-board {
  overflow-x: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 8px;
}
.plan-header,
.plan-row {
  display: grid;
  grid-template-columns: 64px repeat(7, minmax(120px, 1fr));
  gap: 6px;
  align-items: stretch;
}
.plan-header {
  margin-bottom: 6px;
}
.day-head {
  text-align: center;
  font-weight: 600;
  font-size: 13px;
  color: var(--text-2);
  padding: 6px 0;
}
.plan-row {
  margin-bottom: 6px;
}
.meal-label {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--text-2);
  font-weight: 600;
  border-right: 1px solid var(--border);
}
.slot {
  min-height: 56px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--surface-2);
}
.slot--auto {
  background: var(--primary-light);
  border-color: var(--primary);
}
.dish-chip {
  display: flex;
  align-items: center;
  gap: 4px;
}
.dish-chip :deep(.tag) {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rm {
  border: none;
  background: none;
  color: var(--text-2);
  cursor: pointer;
  font-size: 12px;
}
.add-slot {
  border: none;
  background: none;
  color: var(--text-2);
  cursor: pointer;
  font-size: 14px;
  padding: 2px;
}
.add-slot:hover {
  color: var(--primary);
}
.picker-search {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.picker-search input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 14px;
}
.dish-list,
.library {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 50vh;
  overflow-y: auto;
}
.dish-row,
.lib-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.lib-item {
  flex-direction: column;
  align-items: stretch;
}
.lib-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.dish-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.dish-name {
  font-weight: 600;
}
.instr {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lib-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
</style>
