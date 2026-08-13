import { type NextRequest, NextResponse } from 'next/server'

import { updateSession } from '@/lib/supabase/middleware'

export async function proxy(request: NextRequest) {
  if (
    request.nextUrl.pathname === '/api/inngest' ||
    request.nextUrl.pathname.startsWith('/api/cron/') ||
    request.nextUrl.pathname.startsWith('/api/webhooks/')
  ) {
    return NextResponse.next()
  }
  return updateSession(request)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
