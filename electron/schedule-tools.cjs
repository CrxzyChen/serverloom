const definition = (name,description,properties={},required=[]) => ({name,type:'function',description,inputSchema:{type:'object',properties,required,additionalProperties:false}})
const scheduleTools = [
  definition('schedules_list','查询真实定时任务、运行记录、当前队列及暂停状态。'),
  definition('schedules_save','创建或更新真实定时任务。config 是任务 JSON：name,prompt,timezone(IANA),rule({type:once|interval|daily|weekly,at:ISO时间带偏移,minutes:整数,time:HH:mm,days:0到6数组}),serverIds,conversationMode(new|existing),conversationId,operations(readonly|approval),missedPolicy(skip|once),notification(all|attention|none),timeoutMinutes,enabled。默认 readonly、once、attention、30 分钟、new、enabled=true；仅填所选规则需要的字段。更新时提供 id 及变更字段。不要把用户未授权的写操作设为自动执行。',{config:{type:'string',description:'任务配置 JSON 字符串'}},['config']),
  definition('schedules_enable','启用或暂停某个定时任务。暂停不会中断已经执行的任务。',{id:{type:'string'},enabled:{type:'boolean'}},['id','enabled']),
  definition('schedules_run','立即执行一次已有任务，进入串行队列。',{id:{type:'string'}},['id']),
  definition('schedules_remove','按用户要求删除指定定时任务，保留运行记录。',{id:{type:'string'}},['id'])
]
async function executeScheduleTool(scheduler,params) {
  const def=scheduleTools.find(d=>d.name===params.tool), args=params.arguments
  if(!def || params.namespace || !args || Array.isArray(args) || typeof args!=='object')throw new Error('定时任务工具参数无效')
  for(const key of Object.keys(args))if(!def.inputSchema.properties[key] || typeof args[key]!==def.inputSchema.properties[key].type)throw new Error('定时任务工具字段无效')
  for(const key of def.inputSchema.required)if(args[key]===undefined)throw new Error(`缺少 ${key}`)
  if(params.tool==='schedules_list')return scheduler.snapshot()
  if(params.tool==='schedules_save'){
    if(args.config.length>40000)throw new Error('配置过长')
    const config=JSON.parse(args.config)
    return scheduler.save(config.id?config:{conversationMode:'new',serverIds:[],operations:'readonly',missedPolicy:'once',notification:'attention',timeoutMinutes:30,enabled:true,...config})
  }
  if(params.tool==='schedules_enable'){await scheduler.enable(args.id,args.enabled);return{saved:true}}
  if(params.tool==='schedules_run')return scheduler.runNow(args.id)
  await scheduler.remove(args.id);return{removed:true}
}
module.exports={scheduleTools,executeScheduleTool}
