// 会改库或花钱的操作（核对事实、管理专题）的权限：设了口令就凭口令；没设只允许本机直连（经反向代理来的请求不算）。
//   KG_ADMIN_TOKEN   管理口令，请求头 x-kg-admin-token
//   KG_REVIEW_TOKEN  旧的核对口令，请求头 x-kg-review-token，仍然有效

const LOOPBACK = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

/** 本机直连：读写服务器本地文件夹这类操作只认这个，口令也不行 */
export function isLocalRequest(req) {
  return !req.get('x-forwarded-for') && LOOPBACK.includes(req.socket.remoteAddress || '');
}

export function canManage(req) {
  const admin = process.env.KG_ADMIN_TOKEN;
  const review = process.env.KG_REVIEW_TOKEN;
  if (admin || review) {
    const given = [req.get('x-kg-admin-token'), req.get('x-kg-review-token')].filter(Boolean);
    return given.some((t) => t === admin || t === review);
  }
  return isLocalRequest(req);
}

export function requireManage(req, code = 'manage_forbidden') {
  if (!canManage(req)) throw Object.assign(new Error('没有管理权限'), { status: 403, code });
}
