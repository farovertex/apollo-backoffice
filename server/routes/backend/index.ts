/** `/backend` without a path: nothing to proxy (keeps it out of the SSR renderer) */
export default defineEventHandler((event) => {
  setResponseStatus(event, 404)
  return { error: 'not found' }
})
