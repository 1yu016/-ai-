import { applyPresentationControl, mergePresentationObservation, readablePresentation } from './presentation-ownership';

describe('presentation ownership', () => {
  const control = { presentationCommandId: 'B', presentationRevision: 9,
    presentationMode: 'resource', presentationItemId: 'item-B', resourceId: 12,
    returnPoint: { resourceId: 11, currentTime: 4 }, autoPlay: true, currentTime: 0 };
  it('merges only correlated observations, never mode/command/item/return point', () => {
    const result = mergePresentationObservation(control, { ...control,
      presentationMode: 'avatar', presentationItemId: 'evil', returnPoint: {},
      commandId: 'evil', autoPlay: false, currentTime: 12.5, pageIndex: 2,
      status: 'error', errorCode: 'LOAD_FAILED', duration: 100, pageCount: 5 });
    expect(result).toMatchObject({ ...control, currentTime: 12.5, pageIndex: 2,
      observation: { status: 'error', errorCode: 'LOAD_FAILED', presentationRevision: 9 } });
    expect(result).not.toHaveProperty('commandId');
  });
  it('ignores A late reports after B even when both use the same resource', () => {
    expect(mergePresentationObservation(control, { presentationCommandId: 'A', presentationRevision: 8,
      resourceId: 12, currentTime: 99 })).toEqual(control);
    expect(mergePresentationObservation(control, { presentationCommandId: 'B', presentationRevision: 8,
      currentTime: 99 })).toEqual(control);
  });
  it('legacy or uncorrelated feedback cannot change observations or control', () => {
    expect(mergePresentationObservation(control, { resourceId: 12, currentTime: 99 })).toEqual(control);
    expect(mergePresentationObservation({ resourceId: 12 }, { resourceId: 12, currentTime: 99 })).toEqual({ resourceId: 12 });
    expect(readablePresentation({ resourceId: 12, autoPlay: true }).autoPlay).toBe(false);
  });
  it('rejects malformed values and arbitrary error text', () => {
    const next = mergePresentationObservation(control, { presentationCommandId: 'B', presentationRevision: 9,
      currentTime: Infinity, pageIndex: -1, duration: '10', errorCode: 'https://private', resourceId: 99 });
    expect(next.currentTime).toBe(0); expect(next).not.toHaveProperty('pageIndex');
    expect(next.observation).not.toHaveProperty('errorCode');
  });
  it('server mints a revision on each new command, not on progress samples', () => {
    const next = applyPresentationControl(control, { ...control, presentationCommandId: 'C', observation: { currentTime: 1 } }, 10);
    expect(next.presentationRevision).toBe(10); expect(next).not.toHaveProperty('observation');
    expect(applyPresentationControl(next, { ...next, presentationRevision: 999 }, 20).presentationRevision).toBe(10);
  });
});
