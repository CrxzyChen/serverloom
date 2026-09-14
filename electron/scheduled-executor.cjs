// A queue slot remains occupied until the native turn ends, including approval waits.
function createExecutor(runtime, submit, store) {
  return async (run, signal, progress) => {
    signal.throwIfAborted()
    if (runtime.state !== 'ready') throw new Error('Runtime 未就绪，请启动后手动重试')
    const task = run.task
    const data = await store.read()
    const existing = task?.conversationMode === 'existing' ? data.chatThreads?.[run.conversationId] : null
    const value = run.value || {
      conversationId: run.conversationId,
      serverId: existing?.serverId || (task.serverIds.length === 1 ? task.serverIds[0] : undefined),
      settings: task.settings || undefined,
      text: `定时任务：${task.name}\n计划时间：${run.scheduledAt}\n授权范围：${task.operations === 'readonly' ? '仅固定只读检查；禁止任意远程命令和配置修改' : '需要逐次批准命令及修改'}\n目标服务器 ID：${JSON.stringify(task.serverIds)}\n\n${task.prompt}`
    }
    let threadId, turnId, settled = false, text = '', finish, fail
    const pending = [], messages = new Map(), waiting = new Set()
    const completion = new Promise((resolve,reject) => { finish=resolve; fail=reject })
    // Attach a handler immediately; a process exit can occur while submit is still pending.
    completion.catch(() => {})
    const reject = error => { if (!settled) { settled=true; fail(error) } }
    const consume = event => {
      const p = event.params || {}
      if (event.method === 'runtime/status' && p.state !== 'ready') return reject(new Error(p.detail || 'Runtime 连接中断；任务结果可能不完整'))
      if (!threadId) { pending.push(event); return }
      if (p.threadId !== threadId) return
      if (event.method.endsWith('/requestApproval') || event.method === 'item/tool/requestUserInput') { waiting.add(event.id); void progress('waiting',{error:'等待用户审批或回答'}).catch(reject) }
      if (event.method === 'serverRequest/resolved') { waiting.delete(p.requestId); void progress(waiting.size?'waiting':'running',{error:waiting.size?'等待用户审批或回答':null}).catch(reject) }
      if (event.method === 'item/completed' && p.item?.type === 'agentMessage') {
        messages.set(p.item.id,p.item.text);text=[...messages.values()].join('\n\n')
        void progress(waiting.size?'waiting':'running',{result:text}).catch(reject)
      }
      if (event.method === 'turn/completed' && p.turn?.id === turnId) {
        if (p.turn.status !== 'completed') reject(new Error(p.turn.error?.message || `任务${p.turn.status === 'interrupted' ? '已中断' : '失败'}`))
        else if (!settled) { settled=true; finish({text}) }
      }
    }
    const abort = () => {
      runtime.cancelTools()
      // Keep the slot until the native completion event confirms interruption.
      // If interruption cannot be confirmed, terminate the runtime before releasing it.
      if (threadId && turnId) {
        const fallback = setTimeout(() => { runtime.stop(); reject(signal.reason || new Error('任务停止')) }, 10000)
        completion.finally(() => clearTimeout(fallback)).catch(() => {})
        runtime.request('turn/interrupt',{threadId,turnId}).catch(() => { runtime.stop(); reject(signal.reason || new Error('任务停止')) })
      } else { runtime.stop(); reject(signal.reason || new Error('任务停止')) }
    }
    runtime.on('event',consume); signal.addEventListener('abort',abort,{once:true})
    try {
      const result = await submit(value,run,signal)
      threadId=result.threadId;turnId=result.turnId
      signal.throwIfAborted()
      await progress('running',{threadId,turnId})
      for (const event of pending.splice(0)) consume(event)
      return await completion
    } finally { runtime.off('event',consume);signal.removeEventListener('abort',abort) }
  }
}
module.exports = { createExecutor }
