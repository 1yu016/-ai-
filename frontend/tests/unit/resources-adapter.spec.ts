import { describe, expect, it } from 'vitest'
import {
  guessResourceType,
  toArrayField,
  RESOURCE_TYPES,
  AGE_GROUPS,
  REVIEW_STATUSES,
} from '@/api/resources'

describe('resources adapter helpers', () => {
  it('guesses resource type from common extensions', () => {
    expect(guessResourceType('lesson.png')).toBe('image')
    expect(guessResourceType('song.mp3')).toBe('audio')
    expect(guessResourceType('clip.mp4')).toBe('video')
    expect(guessResourceType('slides.pdf')).toBe('pdf')
    expect(guessResourceType('deck.pptx')).toBe('ppt')
    expect(guessResourceType('note.docx')).toBe('document')
    expect(guessResourceType('unknown.xyz')).toBeNull()
  })

  it('parses tag/alias fields that may be comma-separated or JSON array strings', () => {
    expect(toArrayField(['a', 'b'])).toEqual(['a', 'b'])
    expect(toArrayField(' 苹果 ，香蕉 ')).toEqual(['苹果', '香蕉'])
    expect(toArrayField('["x","y"]')).toEqual(['x', 'y'])
    expect(toArrayField('')).toEqual([])
    expect(toArrayField(undefined)).toEqual([])
  })

  it('exposes backend-aligned enums without unknown literals', () => {
    expect(RESOURCE_TYPES).toContain('picture_book')
    expect(RESOURCE_TYPES).toContain('question_bank')
    expect(RESOURCE_TYPES).toContain('model_3d')
    expect(AGE_GROUPS).toContain('small')
    expect(REVIEW_STATUSES).toContain('draft')
    expect(REVIEW_STATUSES).toContain('pending')
  })
})