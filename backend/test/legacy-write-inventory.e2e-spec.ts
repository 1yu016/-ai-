import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const src = join(process.cwd(), 'src');
function parse(path: string) {
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
}
function nodes(root: ts.Node): ts.Node[] {
  const all: ts.Node[] = [];
  const visit = (node: ts.Node) => { all.push(node); ts.forEachChild(node, visit); };
  visit(root); return all;
}
function decorators(node: ts.Node) {
  return ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : [];
}
function routes(path: string) {
  return nodes(parse(join(src, path))).filter(ts.isMethodDeclaration).flatMap(method =>
    decorators(method).flatMap(d => {
      if (!ts.isCallExpression(d.expression) || !ts.isIdentifier(d.expression.expression)) return [];
      const verb = d.expression.expression.text;
      if (!['Post', 'Patch', 'Put', 'Delete'].includes(verb)) return [];
      return [`${verb} ${d.expression.arguments[0]?.getText().slice(1, -1) ?? ''} -> ${method.name.getText()}`];
    })).sort();
}

describe('0.5-3E production write inventory guard (static audit plus HTTP regression)', () => {
  it('accounts for every participation/engagement mutating route, including non-fact configuration', () => {
    expect(routes('classroom-participation/classroom-participation.controller.ts')).toEqual([
      'Post :runId/attendance -> setAttendance', 'Post :runId/attendance/batch -> batchAttendance',
      'Post :runId/attendance/voice/recognize -> recognizeVoice', 'Post :runId/attendance/voice/confirm -> confirmVoice',
      'Post :runId/groups -> createGroup', 'Patch :runId/groups/:groupId -> updateGroup',
      'Delete :runId/groups/:groupId -> deleteGroup', 'Post :runId/groups/:groupId/members -> addGroupMember',
      'Delete :runId/groups/:groupId/members/:studentId -> removeGroupMember',
      'Post :runId/groups/random -> randomGroups', 'Post :runId/roll-calls -> rollCall',
    ].sort());
    expect(routes('classroom-engagement/classroom-engagement.controller.ts')).toEqual([
      'Post badge-definitions -> createBadge', 'Post reward-rules -> createRule', 'Patch reward-rules/:id -> updateRule',
      'Post classroom-runs/:runId/engagement-rewards -> award', 'Post rewards/:rewardId/reverse -> reverseReward',
      'Post classes/:classId/collective-goals -> createGoal', 'Post classes/:classId/growth/adjust -> adjustGrowth',
      'Post classroom-runs/:runId/honors/suggest -> suggestHonor', 'Post honors/:honorId/publish -> publishHonor',
      'Post break-configs -> createBreakConfig', 'Patch break-configs/:id -> updateBreakConfig',
      'Post classroom-runs/:runId/breaks/start -> startBreak', 'Post break-runs/:id/pause -> pauseBreak',
      'Post break-runs/:id/resume -> resumeBreak', 'Post break-runs/:id/end -> endBreak',
    ].sort());
    expect(routes('ai/ai.controller.ts').filter(r => r.includes('classroom-command'))).toEqual([
      'Post classroom-command -> classroomCommandV2', 'Post classroom-command/execute -> executeClassroomCommand',
      'Post classroom-command/offline-logs -> uploadOfflineClassroomCommandLogs',
      'Post classroom-command/rules -> saveClassroomCommandRule',
    ].sort());
  });

  it('finds no repository/manager/raw SQL business write owner outside canonical services', () => {
    const legacy = ['AttendanceRecord', 'AttendanceChangeLog', 'RollCallRecord', 'RollCallCandidateSnapshot',
      'RewardRecord', 'RewardReversal', 'StudentBadge', 'ClassGrowthRecord', 'HonorRecord'];
    const owners: Record<string, string> = {
      StudentRewardRecord: 'classroom-runs/student-reward.service.ts',
      ClassCollectiveRewardRecord: 'classroom-runs/student-reward.service.ts',
      StudentAttendanceRecord: 'classroom-runs/attendance.service.ts',
      StudentAttendanceChange: 'classroom-runs/attendance.service.ts',
      ClassroomRollCallRecord: 'classroom-runs/classroom-roll-call.service.ts',
      ClassroomSnapshot: 'classroom-runs/classroom-snapshot.service.ts',
    };
    const protectedNames = new Set([...legacy, ...Object.keys(owners)]);
    const violations: string[] = [];
    const files = readdirSync(src, { recursive: true }).map(String)
      .filter(p => p.endsWith('.ts') && !p.endsWith('.spec.ts') && !p.startsWith('migrations'));
    const mutations = new Set(['save', 'insert', 'update', 'upsert', 'delete', 'remove', 'softDelete', 'softRemove', 'restore', 'increment', 'decrement', 'clear']);
    for (const path of files) {
      const file = parse(join(src, path));
      const all = nodes(file);
      // Over-approximate aliases per file (not just one method) so a same-name
      // repository alias cannot hide a prohibited write in a different scope.
      const aliases = new Map<string, Set<string>>();
      const add = (key: string, types: string[]) => {
        aliases.set(key, new Set([...(aliases.get(key) ?? []), ...types]));
      };
      for (const n of all.filter(ts.isParameter)) {
        if (n.type && ts.isTypeReferenceNode(n.type) && n.type.typeName.getText() === 'Repository')
          add(n.name.getText(), [n.type.typeArguments?.[0]?.getText() ?? '']);
      }
      const resolve = (n: ts.Expression): string[] => {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'getRepository')
          return [n.arguments[0]?.getText() ?? ''];
        if (ts.isIdentifier(n)) return [...(aliases.get(n.text) ?? [])];
        if (ts.isPropertyAccessExpression(n) && n.expression.kind === ts.SyntaxKind.ThisKeyword)
          return [...(aliases.get(n.name.text) ?? [])];
        return [];
      };
      for (let pass = 0; pass < 3; pass++) for (const n of all.filter(ts.isVariableDeclaration)) {
        if (n.initializer && ts.isIdentifier(n.name)) add(n.name.text, resolve(n.initializer));
      }
      for (const n of all.filter(ts.isCallExpression)) {
        if (!ts.isPropertyAccessExpression(n.expression)) continue;
        const op = n.expression.name.text;
        const p = relative(src, file.fileName).replace(/\\/g, '/');
        if (mutations.has(op)) {
          const entities = [...resolve(n.expression.expression), n.arguments[0]?.getText() ?? ''];
          for (const entity of entities.filter(e => protectedNames.has(e))) {
            if (legacy.includes(entity) || owners[entity] !== p)
              violations.push(`${p}:${file.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${op} ${entity}`);
          }
        }
        if (op === 'query' && n.arguments[0]) {
          const sql = n.arguments[0].getText();
          if (/\b(?:INSERT\s+INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:"|`|\[)?(?:attendance_record|attendance_change_log|roll_call_record|roll_call_candidate_snapshot|reward_record|reward_reversal|student_badge|class_growth_record|student_reward_record|class_collective_reward_record|student_attendance_record|student_attendance_change|classroom_roll_call_record|classroom_snapshot)\b/i.test(sql))
            violations.push(`${p}: raw business SQL write`);
        }
        if (op === 'captureBusinessRequired' && ![
          'classroom-runs/student-reward.service.ts', 'classroom-runs/attendance.service.ts',
          'classroom-runs/classroom-roll-call.service.ts',
        ].includes(p)) violations.push(`${p}: non-canonical projection caller`);
      }
    }
    // This is a source regression alarm, not a claim to prove arbitrary dynamic
    // code safe. HTTP database comparisons and manual reachability audit remain required.
    expect(violations).toEqual([]);
  });
});
