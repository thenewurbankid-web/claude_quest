#!/usr/bin/env python3
# Creates the R5 issues in the local Paperclip (paperclip/R5-issues.md): one parent, three children assigned to Quest
# Dev in order. Run once: python3 paperclip/create-r5-issues.py
import json, urllib.request

B = 'http://127.0.0.1:3100/api'
C = 'f0f96626-f3d4-4633-af8d-ee563d0cc481'   # company "Claude Quest"
P = 'f2228914-d3bb-4a5d-b671-c74abcee3887'   # project "Claude Quest"
QD = '2a7aa32d-e6cb-40a2-98bf-0d7be5337f4a'  # agent "Quest Dev"


def post(path, body):
    req = urllib.request.Request(B + path, data=json.dumps(body).encode(), method='POST',
                                 headers={'content-type': 'application/json'})
    x = json.load(urllib.request.urlopen(req))
    return x.get('issue', x)


def mk(title, desc, parent=None):
    body = {'projectId': P, 'title': title, 'description': desc, 'status': 'todo', 'priority': 'high'}
    if parent:
        body.update(parentId=parent, assigneeAgentId=QD)
    i = post(f'/companies/{C}/issues', body)
    print(i.get('identifier'), i['id'], title)
    return i['id']


r5 = mk('R5 Missions and the first Sealed Hall',
        'Release R5 (PLAN-engine.md "Releases" and "Missions, Keepers and the Bridge"; HANDOFF.md "R5 checklist"). '
        'Already built: the contract (0e54f1d, d8c5270) and missions.js with pressure and the gate (6b83994). '
        'The children are the rest, in order. Done when all children are.')
mk('R5 Keepers: summon with Ember, join on the first approved Work, release to the Hall of Champions',
   'R5 checklist item 4; see paperclip/R5-issues.md, issue 1. Comes first.', r5)
mk('R5 UI: Missions tab on the notice board, mission HUD, briefing and debrief',
   'R5 checklist item 5 without integration; see paperclip/R5-issues.md, issue 2. After the Keepers issue.', r5)
mk('R5 integration: wire missions, the pressure gate and Keepers into the game',
   'boot.js and scene.js; see paperclip/R5-issues.md, issue 3. After the UI issue.', r5)
