import { describe, expect, it } from 'vitest'
import { ToolState, groupOf, groupsFor } from '@/ui/tools'

describe('groupsFor', () => {
  it('offers five groups for a PDF — the whole point of the change', () => {
    const groups = groupsFor('pdf')
    expect(groups.map((group) => group.id)).toEqual([
      'lesen',
      'markieren',
      'stift',
      'notiz',
      'mehr',
    ])
  })

  it('drops the text tools for an image, which has no text', () => {
    const groups = groupsFor('image')
    expect(groups.map((group) => group.id)).not.toContain('markieren')
    expect(groups.find((group) => group.id === 'mehr')?.members).toEqual(['textfeld', 'abdecken'])
  })

  it('leaves a reflowable document only what works without a page', () => {
    const groups = groupsFor('flow')
    expect(groups.map((group) => group.id)).toEqual(['lesen', 'markieren'])
  })

  it('never produces an empty group', () => {
    for (const kind of ['pdf', 'image', 'flow'] as const) {
      for (const group of groupsFor(kind)) expect(group.members.length).toBeGreaterThan(0)
    }
  })
})

describe('groupOf', () => {
  it('finds the group a tool belongs to', () => {
    const groups = groupsFor('pdf')
    expect(groupOf('durchstreichen', groups)?.id).toBe('markieren')
    expect(groupOf('radierer', groups)?.id).toBe('stift')
    expect(groupOf('bearbeiten', groups)?.id).toBe('mehr')
  })
})

describe('ToolState', () => {
  it('remembers which member of a group was last used', () => {
    const tools = new ToolState()
    const groups = groupsFor('pdf')
    const marking = groups.find((group) => group.id === 'markieren')!

    // Nothing used yet: the group's default.
    expect(tools.memberOf(marking)).toBe('markieren')

    tools.set('unterstreichen', 'markieren')
    tools.set('lesen')
    expect(tools.memberOf(marking)).toBe('unterstreichen')
  })

  it('ignores a remembered member that the group no longer offers', () => {
    const tools = new ToolState()
    tools.set('bearbeiten', 'mehr')

    // An image has no "Text bearbeiten"; the group falls back to its first.
    const imageMore = groupsFor('image').find((group) => group.id === 'mehr')!
    expect(tools.memberOf(imageMore)).toBe('textfeld')
  })

  it('knows when a tool has claimed the finger, and which kind', () => {
    const tools = new ToolState()
    expect(tools.isActive).toBe(false)

    tools.set('markieren')
    expect(tools.isActive).toBe(true)
    expect(tools.isMarking).toBe(true)
    expect(tools.isDrawing).toBe(false)

    tools.set('stift')
    expect(tools.isMarking).toBe(false)
    expect(tools.isDrawing).toBe(true)
  })
})
