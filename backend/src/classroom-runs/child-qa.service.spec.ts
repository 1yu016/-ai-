import { ChildQaService } from './child-qa.service';
import { jest } from '@jest/globals';
import { AuthUserType } from '../auth/entities/refresh-token-session.entity';
import { LocalChildKnowledgeProvider } from './child-qa.core';
describe('authoritative child QA session and existing records', () => {
  let service: ChildQaService;
  let run: any;
  let record: any;
  let runs: any;
  let records: any;
  let questions: any;
  const actor = { sub: 1, userType: AuthUserType.Teacher } as any;
  beforeEach(() => {
    run = { id: 10, teacherId: 1, deviceId: 2, version: 1, status: 'running', currentStepIndex: 0,
      steps: [{ stepIndex: 0, actionConfig: [{ actionType: 'child_qa', actionName: 'configure', content: JSON.stringify({ seconds: 120, policy: 'teacher_review', topic: '种子发芽' }) }] }] };
    record = { id: 20, classroomRunId: 10, qaSessionId: null, answerStatus: null };
    runs = { get: jest.fn(async () => run), assertOperation: jest.fn(async () => { if (run.status !== 'running') throw new Error('policy denied'); }) };
    records = { findOneByOrFail: jest.fn(async () => record), findOneBy: jest.fn(async (filter) => Object.entries(filter).every(([k,v]) => record[k] === v) ? record : null), save: jest.fn(async value => value), update: jest.fn(async (filter, patch) => { if (filter.qaSessionId === record.qaSessionId && record.answerStatus === 'pending') Object.assign(record, patch); }) };
    questions = { create: jest.fn(async () => ({ question: { id: 20, questionText: '种子需要什么？' } })) };
    service = new ChildQaService(runs, questions, records, new LocalChildKnowledgeProvider());
  });
  afterEach(() => jest.useRealTimers());
  it('keeps a newly recognized short water question in the existing record and approval flow', async () => {
    await service.start(actor, 10, 'water-session');
    const result = await service.ask(actor, 10, {sessionId:'water-session', requestId:'water-question', question:'芽需要水'});
    expect(result.question).toMatchObject({answerStatus:'pending', answerSource:'curated_seed_germination_v1'});
    expect(record.answerText).toContain('适量的水');
    expect(questions.create).toHaveBeenCalledWith(actor, 10, expect.objectContaining({questionText:'芽需要水', lessonStepIndex:0, isAnonymous:true}));
    await expect(service.approvedPresentation(actor, 10, 'water-session', 20, record.answerText)).rejects.toThrow('审核');
    await service.review(actor, 10, 'water-session', 20, true);
    await expect(service.approvedPresentation(actor, 10, 'water-session', 20, record.answerText)).resolves.not.toThrow();
  });
  it('is closed by default and rejects child input before teacher start', async () => {
    expect((await service.state(actor, 10)).mode).toBe('teacher');
    await expect(service.ask(actor,10,{sessionId:'none',requestId:'q1',question:'种子需要什么？'})).rejects.toThrow('已关闭');
    expect(questions.create).not.toHaveBeenCalled();
  });
  it('cannot start when the frozen current step has no valid child QA configuration', async () => {
    run.steps[0].actionConfig = [];
    await expect(service.start(actor, 10, 'unconfigured')).rejects.toThrow('未配置儿童问答');
    expect((await service.state(actor, 10)).mode).toBe('teacher');
  });
  it.each(['pause','step','version','timeout','run','device'])('invalidates %s without creating a question', async kind => {
    jest.useFakeTimers();const start=await service.start(actor,10,'s1');
    if(kind==='pause')run.status='paused';if(kind==='step')run.currentStepIndex=1;if(kind==='version')run.version=2;
    if(kind==='run')run.id=11;if(kind==='device')run.deviceId=3;if(kind==='timeout')jest.advanceTimersByTime(6001);
    await expect(service.ask(actor,10,{sessionId:start.session.id,requestId:'q1',question:'结束课堂'})).rejects.toThrow('已关闭');
    expect(questions.create).not.toHaveBeenCalled();
  });
  it('saves through the original question service, requires review, then rejects old input after stop', async () => {
    await service.start(actor,10,'s1');
    const input={sessionId:'s1',requestId:'q1',question:'种子需要什么？'};
    const reply=await service.ask(actor,10,input);expect(reply.question.answerStatus).toBe('pending');
    await expect(service.approvedPresentation(actor,10,'s1',20,record.answerText)).rejects.toThrow('审核');
    await service.review(actor,10,'s1',20,true);
    await service.approvedPresentation(actor,10,'s1',20,record.answerText);
    await service.stop(actor,10);
    await expect(service.ask(actor,10,input)).rejects.toThrow('已关闭');expect(questions.create).toHaveBeenCalledTimes(1);
  });
  it('never permits another teacher or administrator to manage the session', async () => {
    await expect(service.start({...actor,sub:2},10,'s')).rejects.toThrow('本节课堂');
    await expect(service.start({...actor,userType:AuthUserType.Administrator},10,'s')).rejects.toThrow('只有课堂教师');
  });
  it('ignores an old stop after reopening and closes on teacher takeover without changing the Run version', async () => {
    await service.start(actor,10,'old');
    await service.start(actor,10,'new');
    expect((await service.stop(actor,10,'old')).stopped).toBe(false);
    expect((await service.state(actor,10)).session?.id).toBe('new');
    await service.ask(actor,10,{sessionId:'new',requestId:'q1',question:'种子需要什么？'});
    await service.onTeacherControl(actor,10);
    expect(record.answerStatus).toBe('cancelled');
    expect((await service.state(actor,10)).mode).toBe('teacher');
    expect(run.version).toBe(1);
  });
  it('hands provider failure to the teacher and rejects a provider trying to preapprove unsafe output', async () => {
    service=new ChildQaService(runs,questions,records,{answer:()=>{throw new Error('offline')}});
    await service.start(actor,10,'s1');const result=await service.ask(actor,10,{sessionId:'s1',requestId:'q1',question:'种子需要什么？'});
    expect(result.question.answerStatus).toBe('handoff');expect(result.question.answerSource).toBe('provider_unavailable');
    record.qaSessionId=null;
    service=new ChildQaService(runs,questions,records,{answer:()=>({status:'pending',answer:'https://unapproved.invalid',source:'unsafe'})});
    await service.start(actor,10,'s2');expect((await service.ask(actor,10,{sessionId:'s2',requestId:'q2',question:'种子需要什么？'})).question.answerStatus).toBe('handoff');
  });
  it('discards a provider result delivered after teacher stop', async () => {
    let resolve!: (value:any)=>void;
    service=new ChildQaService(runs,questions,records,{answer:()=>new Promise(res=>{resolve=res})});
    await service.start(actor,10,'s1');const pending=service.ask(actor,10,{sessionId:'s1',requestId:'q1',question:'种子需要什么？'});
    await new Promise(resolve=>setImmediate(resolve));await service.stop(actor,10);resolve({status:'pending',answer:'late',source:'test'});
    await expect(pending).rejects.toThrow('已关闭');expect(questions.create).not.toHaveBeenCalled();
  });
});
