#!/usr/bin/env python3
# Sets up Boxing Manager AI in the local Paperclip: a company, a project on this worktree, the Boxing Dev agent
# (claude_local, same settings as Quest Dev, heartbeat every 30 min, wakes only when it has work) and the first two
# issues. Instructions: paperclip/BOXING-DEV.md. Run once: python3 paperclip/create-boxing.py
import json, pathlib, urllib.error, urllib.request

B = 'http://127.0.0.1:3100/api'
WT = '/Users/shashank/Repositories/claude-quest/.claude/worktrees/boxing-manager-ai'


def call(method, path, body=None):
    req = urllib.request.Request(B + path, data=body and json.dumps(body).encode(), method=method,
                                 headers={'content-type': 'application/json'})
    try:
        return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        raise SystemExit(f'{method} {path}: {e.code} {e.read().decode()[:500]}')


C = call('POST', '/companies', {'name': 'Boxing Manager',
         'description': 'Boxing Manager AI: a street-fight manager game in claude-quest public/boxing/, built in the '
                        'worktree-boxing-manager-ai worktree.'})['id']
print('company', C)
P = call('POST', f'/companies/{C}/projects', {'name': 'Boxing Manager AI', 'status': 'in_progress',
         'workspace': {'name': 'boxing-manager-ai worktree', 'sourceType': 'local_path', 'cwd': WT}})['id']
print('project', P)
ag = call('POST', f'/companies/{C}/agents', {
    'name': 'Boxing Dev', 'role': 'engineer', 'title': 'Game developer', 'icon': 'wrench',
    'capabilities': 'Builds Boxing Manager AI (Babylon.js 3D, deterministic combat sim, Dexie, P2P) one issue per run.',
    'adapterType': 'claude_local',
    'adapterConfig': {'cwd': WT, 'model': 'claude-sonnet-5-5', 'effort': 'medium', 'engine': 'cli', 'command': 'claude',
                      'graceSec': 30, 'timeoutSec': 3600, 'maxTurnsPerRun': 200,
                      'workspaceStrategy': {'type': 'project_primary'}, 'dangerouslySkipPermissions': True},
    'instructionsBundle': {'entryFile': 'AGENTS.md',
                           'files': {'AGENTS.md': pathlib.Path(WT, 'paperclip/BOXING-DEV.md').read_text()}},
    'runtimeConfig': {'heartbeat': {'enabled': True, 'intervalSec': 1800, 'maxConcurrentRuns': 1,
                                    'skipTimerWhenNoActionableWork': True}}})
A = ag.get('agent', ag)['id']
print('agent', A)


def mk(title, desc):
    i = call('POST', f'/companies/{C}/issues', {'projectId': P, 'title': title, 'description': desc, 'status': 'todo',
                                                'priority': 'high', 'assigneeAgentId': A})
    i = i.get('issue', i)
    print(i.get('identifier'), i['id'], title)
    return i.get('identifier')


j2 = mk('Character creation: finish and check job 2',
        'public/boxing/HANDOFF.md "Next jobs" item 2 (picked by the user). Most of it is in commit 9717ad6 (WIP, never '
        'run in a browser): LOOK_OPTIONS, normalizeLook, skin tones, the Look panel with look-preview.js, the look saved '
        'with the fighter, profileOf sends it. Review that commit against the job, then close the gaps: the look '
        'survives a reload (Dexie fighters store), the AI corner and a P2P opponent render their own look, a received '
        'look always goes through normalizeLook, tests for normalizeLook and profileOf. Comes first.')
mk('Night view: hide the first-load shader compile',
   'public/boxing/HANDOFF.md "Next jobs" item 3 and the known issue under "the reference photo rebuilt": night takes '
   'about 15 s to load while the 15-light shaders compile. Use scene.whenReadyAsync (or similar) and a loading card; '
   "don't remove lights or change the look. After " + str(j2) + '.')
