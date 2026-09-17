import { describe, expect, it } from 'vitest'

import { decideIsolationAction, type IsolationState } from '@/register-sw'

/**
 * The decision that turns "1 Thread" into "8 Threads". It shipped wrong once:
 * the old code treated a *controlled* page as a finished one and skipped the
 * reload, so the multi-threaded ffmpeg core never loaded on GitHub Pages.
 */

const state = (overrides: Partial<IsolationState> = {}): IsolationState => ({
  isolated: false,
  alreadyReloaded: false,
  hasActiveWorker: false,
  hasPendingWorker: false,
  ...overrides,
})

describe('decideIsolationAction', () => {
  it('does nothing once the page is isolated', () => {
    expect(decideIsolationAction(state({ isolated: true, hasActiveWorker: true }))).toBe('none')
  })

  it('reloads when a worker is active but the page is not isolated', () => {
    expect(decideIsolationAction(state({ hasActiveWorker: true }))).toBe('reload')
  })

  it('REGRESSION: still reloads a page the worker has already claimed', () => {
    // clients.claim() takes control of the first, header-less load too. The
    // old code read "controlled" as "done" and returned here, which is exactly
    // why the deployed build stayed single-threaded. Control is deliberately
    // not part of the decision any more.
    expect(decideIsolationAction(state({ hasActiveWorker: true, hasPendingWorker: false }))).toBe(
      'reload',
    )
  })

  it('waits for a worker that is still installing', () => {
    expect(decideIsolationAction(state({ hasPendingWorker: true }))).toBe('wait-then-reload')
  })

  it('prefers an active worker over a pending one', () => {
    expect(
      decideIsolationAction(state({ hasActiveWorker: true, hasPendingWorker: true })),
    ).toBe('reload')
  })

  it('never reloads twice in one session', () => {
    // The guard against an endless loop on hosts where isolation is impossible.
    expect(
      decideIsolationAction(state({ alreadyReloaded: true, hasActiveWorker: true })),
    ).toBe('none')
    expect(
      decideIsolationAction(state({ alreadyReloaded: true, hasPendingWorker: true })),
    ).toBe('none')
  })

  it('does nothing when there is no worker at all', () => {
    expect(decideIsolationAction(state())).toBe('none')
  })
})
