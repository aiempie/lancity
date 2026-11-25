import { app } from '@/server/api/v1'

function handle(request: Request) {
  return app.fetch(request)
}

export {
  handle as GET,
  handle as POST,
  handle as PUT,
  handle as PATCH,
  handle as DELETE,
  handle as HEAD,
  handle as OPTIONS
}
