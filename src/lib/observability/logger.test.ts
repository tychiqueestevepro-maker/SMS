// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { logServerEvent } from './logger'

describe('logServerEvent', () => {
  afterEach(() => vi.restoreAllMocks())

  it('redacts secrets while retaining correlation identifiers', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    logServerEvent(
      'info',
      { event: 'message.reserved', workspace_id: 'workspace-1', message_id: 'message-1' },
      {
        apiKey: 'never-log-this',
        event: 'cannot-override-event',
        nested: { authToken: 'also-secret', reason: 'scheduled' },
        providerMessage: 'Authorization: Bearer unsafe-token',
        rawSdkMessage:
          'password extremely-sensitive credential: another-secret seti_123_secret_client-value 0123456789abcdef0123456789abcdef',
      },
    )

    const payload = JSON.parse(String(info.mock.calls[0]?.[0]))
    expect(payload.workspace_id).toBe('workspace-1')
    expect(payload.message_id).toBe('message-1')
    expect(payload.event).toBe('message.reserved')
    expect(payload.apiKey).toBe('[REDACTED]')
    expect(payload.nested.authToken).toBe('[REDACTED]')
    expect(payload.nested.reason).toBe('scheduled')
    expect(payload.providerMessage).toBe('Authorization: Bearer [REDACTED]')
    expect(payload.rawSdkMessage).not.toContain('extremely-sensitive')
    expect(payload.rawSdkMessage).not.toContain('another-secret')
    expect(payload.rawSdkMessage).not.toContain('client-value')
    expect(payload.rawSdkMessage).not.toContain('0123456789abcdef')
  })
})
