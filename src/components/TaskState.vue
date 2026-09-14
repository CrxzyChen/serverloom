<script setup>
import { computed, ref, watch } from 'vue'
import { Target, ListChecks, ChevronRight, Play } from 'lucide-vue-next'
import MarkdownMessage from './MarkdownMessage.vue'
const props=defineProps({state:Object,running:Boolean,conversationId:String})
const emit=defineEmits(['execute','answer'])
const expanded=ref(false),answers=ref({}),submitting=ref(false)
watch(()=>props.conversationId,()=>{expanded.value=false;answers.value={}})
const labels={active:'进行中',paused:'已暂停',blocked:'受阻',usageLimited:'额度受限',budgetLimited:'预算用尽',complete:'已完成'}
const completed=computed(()=>(props.state.plan||[]).filter(s=>s.status==='completed').length)
async function answer(q){submitting.value=true;try{const values=Object.fromEntries(q.params.questions.map(item=>[item.id,{answers:[answers.value[q.id+'-'+item.id]||'']} ]));emit('answer',q,values)}finally{submitting.value=false}}
</script>
<template><div v-if="state.goal||state.plan?.length||state.proposal||state.questions?.length" class="task-state">
<button v-if="state.goal||state.plan?.length||state.proposal" type="button" class="task-state-toggle" :title="state.goal?.objective" :aria-expanded="expanded" @click="expanded=!expanded"><Target v-if="state.goal" :size="14"/><ListChecks v-else :size="14"/><span>{{ state.goal?state.goal.objective:state.plan?.length?'执行计划':'规划方案' }}</span><small>{{ state.goal?labels[state.goal.status]||state.goal.status:state.plan?.length?`${completed}/${state.plan.length}`:'' }}</small><ChevronRight :size="13" :class="{rotated:expanded}"/></button>
<div v-if="expanded" class="task-state-body"><p v-if="state.goal">{{ labels[state.goal.status] }} · {{ Math.floor((state.goal.timeUsedSeconds||0)/60) }} 分钟 · {{ state.goal.tokensUsed?.toLocaleString() }} tokens<span v-if="state.goal.tokenBudget!=null"> / {{ state.goal.tokenBudget.toLocaleString() }}</span></p><small v-if="state.goalError">状态刷新失败，显示上次记录</small><ol v-if="state.plan?.length"><li v-for="(item,i) in state.plan" :key="i" :class="item.status"><span class="step-state">{{ {pending:'待办',inProgress:'进行中',completed:'完成'}[item.status] }}</span>{{ item.step }}</li></ol><MarkdownMessage v-if="state.proposal" :source="state.proposal"/><button v-if="state.proposal" type="button" :disabled="running||state.proposalComplete===false" @click="emit('execute',state.proposal)"><Play :size="13"/>按此计划执行</button></div>
<form v-for="request in state.questions||[]" :key="request.id" class="plan-question" @submit.prevent="answer(request)"><div v-for="question in request.params.questions" :key="question.id"><strong>{{ question.header }}</strong><p>{{ question.question }}</p><label v-for="option in question.options||[]" :key="option.label" class="question-option"><input type="radio" :name="request.id+'-'+question.id" :value="option.label" v-model="answers[request.id+'-'+question.id]"/><span>{{ option.label }}<small>{{ option.description }}</small></span></label><label class="question-custom">补充或直接回答<input :type="question.isSecret?'password':'text'" v-model="answers[request.id+'-'+question.id]" autocomplete="off" required maxlength="10000"/></label></div><button type="submit" :disabled="submitting">提交回答</button></form>
</div></template>
