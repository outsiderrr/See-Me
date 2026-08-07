import { beforeEach, describe, expect, it } from 'vitest';
import { createNote, updateNote } from '../notes';
import { makeUser, resetDb } from '../test/helpers';

describe('note topics', () => {
  beforeEach(resetDb);

  it('stores a topic on create and can update or clear it independently', async () => {
    const user = await makeUser();
    const created = await createNote(user.id, '第一段完整的思考', '交易的机会成本');
    expect(created.topic).toBe('交易的机会成本');

    const renamed = await updateNote(user.id, created.id, created.body, '交易决策质量');
    expect(renamed?.topic).toBe('交易决策质量');

    const cleared = await updateNote(user.id, created.id, created.body, null);
    expect(cleared?.topic).toBeNull();
  });
});
