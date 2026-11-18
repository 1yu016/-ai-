"""Optional user-run importer for the existing local classroom API. Never runs on extraction."""
import getpass
import hashlib
import json
from pathlib import Path
import sys
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parent
BASE = 'http://127.0.0.1:3592'
FOLDERS = ['malt-bear', 'cloud-bunny', 'citrus-owl']

def request(method, route, token=None, value=None, upload=None, fields=None):
    headers = {}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    if upload:
        boundary = 'AvatarPack' + uuid.uuid4().hex
        pieces = []
        for key, val in (fields or {}).items():
            pieces.append(('--' + boundary + '\r\nContent-Disposition: form-data; name="' + key + '"\r\n\r\n' + val + '\r\n').encode())
        mime = 'model/gltf-binary' if upload.suffix == '.glb' else 'image/png' if upload.suffix == '.png' else 'application/json'
        pieces.append(('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + upload.name + '"\r\nContent-Type: ' + mime + '\r\n\r\n').encode())
        pieces.extend([upload.read_bytes(), ('\r\n--' + boundary + '--\r\n').encode()])
        data = b''.join(pieces)
        headers['Content-Type'] = 'multipart/form-data; boundary=' + boundary
    elif value is not None:
        data = json.dumps(value, ensure_ascii=False).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    else:
        data = None
    req = urllib.request.Request(BASE + route, data=data, headers=headers, method=method)
    try:
        # Do not forward local credentials through system proxy settings.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(req, timeout=45) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        message = exc.read().decode('utf-8', errors='replace')[:500]
        raise RuntimeError('HTTP ' + str(exc.code) + '：' + message) from None

def main():
    print('本工具仅在你确认后，将一套角色上传到本机 3592。不会分配班级、切换课堂或调用收费 AI。')
    manifests = [json.loads((ROOT / f / 'manifest.json').read_text(encoding='utf-8')) for f in FOLDERS]
    for i, m in enumerate(manifests, 1):
        print(str(i) + '. ' + m['name'])
    choice = input('输入 1—3 选择一个角色，其他内容退出：').strip()
    if choice not in ['1', '2', '3']:
        return
    index = int(choice) - 1
    m = manifests[index]
    folder = ROOT / FOLDERS[index]
    for filename, expected in m['sha256'].items():
        if Path(filename).name != filename:
            raise RuntimeError('不安全的文件名')
        if hashlib.sha256((folder / filename).read_bytes()).hexdigest() != expected:
            raise RuntimeError('文件校验失败：' + filename + '；请重新解压原始文件包。')
    if input('确认向 ' + BASE + ' 导入“' + m['name'] + '”？输入 导入 继续：').strip() != '导入':
        return
    account = input('本系统管理员账号：').strip()
    password = getpass.getpass('管理员登录密码（不会显示或保存）：')
    login = request('POST', '/auth/admin/login', value={'account': account, 'password': password})
    password = None
    token = login['access_token']
    profile = request('GET', '/auth/profile', token)
    if profile.get('userType') != 'administrator' and profile.get('role') != 'admin':
        raise RuntimeError('需要管理员身份，已停止。')
    existing = request('GET', '/avatars/characters?pageSize=100', token)
    if any(item.get('name') == m['name'] for item in existing.get('items', [])):
        raise RuntimeError('角色库已存在同名角色，已停止以避免重复。可到角色库继续配置。')
    created = request('POST', '/avatars/characters', token, value={key:m[key] for key in ['name','category','description']})
    character_id = created['id']
    print('已创建角色草稿，角色编号：', character_id)
    version = request('POST', '/avatars/characters/' + str(character_id) + '/versions', token,
                      upload=folder / m['model'], fields={'engineVersion': m['engineVersion'], 'modelFormat': m['modelFormat']})
    version_id = version['id']
    for asset in m['assets']:
        fields = {'assetType':asset['assetType']}
        if 'actionName' in asset:
            fields['actionName'] = asset['actionName']
        request('POST', '/avatars/versions/' + str(version_id) + '/assets', token, upload=folder / asset['file'], fields=fields)
        print('已上传：', asset['file'])
    check = request('GET', '/avatars/versions/' + str(version_id) + '/integrity', token)
    if not check.get('valid'):
        print('服务器完整性校验未通过：', json.dumps(check.get('issues'), ensure_ascii=False))
        print('草稿和文件已保留，请到角色库检查。没有发布。')
        return
    print('上传和完整性校验完成。')
    if input('是否发布版本并提交角色审核？输入 提交 继续，其他内容保留草稿：').strip() != '提交':
        return
    request('POST', '/avatars/versions/' + str(version_id) + '/publish', token)
    request('POST', '/avatars/characters/' + str(character_id) + '/submit-review', token)
    print('已提交审核。请在管理员“数字人角色库”中预览、审核通过，再自行分配班级。')
    print('本工具没有审批角色、分配班级或切换正在运行的课堂。')

if __name__ == '__main__':
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        print('\n已取消。')
    except Exception as exc:
        print('导入停止：', str(exc))
        print('如已创建草稿，已上传文件会保留。请到角色库处理，不要反复重复导入。')
        sys.exit(1)
