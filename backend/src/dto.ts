import type { Note, Tag, NoteTag } from '@prisma/client';

export type NoteWithTags = Note & { noteTags: (NoteTag & { tag: Tag })[] };

/** Author-side note DTO (A owns these — full tag list is fine here). */
export function noteDto(n: NoteWithTags) {
  return {
    id: n.id,
    body: n.body,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    tags: n.noteTags.map((nt) => ({ id: nt.tag.id, name: nt.tag.name })),
  };
}
