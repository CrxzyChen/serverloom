const { randomUUID } = require('node:crypto')
const READONLY = new Set(['servers_list','servers_test_connection','servers_inspect_hardware','schedules_list'])
class ScheduleApprovals {
  constructor(emit){this.emit=emit;this.pending=new Map()}
  async check(run,params,signal){
    if(!run?.task)return
    if(params.tool.startsWith('schedules_') && params.tool!=='schedules_list')throw new Error('后台任务不能自行修改或创建定时任务')
    if(params.tool!=='servers_list' && params.tool!=='schedules_list' && !run.task.serverIds.includes(params.arguments?.id))throw new Error('此服务器不在定时任务授权范围内')
    if(READONLY.has(params.tool))return
    if(run.task.operations==='readonly')throw new Error('此任务仅允许固定只读检查；任意命令及修改不在授权范围内')
    signal.throwIfAborted()
    await new Promise((resolve,reject)=>{
      const id=`scheduled-${randomUUID()}`, event={id,method:'scheduler/tool/requestApproval',conversationId:run.conversationId,params:{threadId:params.threadId,tool:params.tool,arguments:params.arguments,runId:run.id}}
      const finish=error=>{this.pending.delete(id);signal.removeEventListener('abort',abort);this.emit({method:'serverRequest/resolved',conversationId:run.conversationId,params:{threadId:params.threadId,requestId:id}});error?reject(error):resolve()}
      const abort=()=>finish(signal.reason||new Error('任务已取消'))
      this.pending.set(id,{event,finish});signal.addEventListener('abort',abort,{once:true});this.emit(event)
    })
  }
  answer(id,decision){const pending=this.pending.get(id);if(!pending)throw new Error('审批已失效');if(!['accept','decline'].includes(decision))throw new Error('审批选项无效');pending.finish(decision==='accept'?null:new Error('用户拒绝了本次操作'))}
}
module.exports={ScheduleApprovals,READONLY}
