/** Leaving a control page never changes the server's classroom state. */
export function requiresClassroomExitConfirmation(status: string | null | undefined): boolean {
  return status === 'running' || status === 'paused'
}

export const CLASSROOM_EXIT_MESSAGE = '课堂仍在进行。离开控制页面不会暂停或结束课堂，大屏将继续展示当前内容。您可以从工作台重新进入。确定离开吗？'
export const CLASSROOM_LOGOUT_MESSAGE = '课堂仍在进行。退出账号不会暂停或结束课堂，大屏可能继续展示当前内容；重新登录后可继续控制。确定退出账号吗？'
