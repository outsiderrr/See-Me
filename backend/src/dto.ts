import type { Note, NoteImage, Tag, NoteTag } from '@prisma/client';

export type NoteWithTags = Note & {
  noteTags: (NoteTag & { tag: Tag })[];
  images: NoteImage[];
};

/** Author-side note DTO (A owns these — full tag list is fine here). */
export function noteDto(n: NoteWithTags) {
  return {
    id: n.id,
    body: n.body,
    topic: n.topic,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    tags: n.noteTags.map((nt) => ({ id: nt.tag.id, name: nt.tag.name })),
    images: n.images.map((image) => ({ id: image.id })),
  };
}
