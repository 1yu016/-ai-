import pluginVue from 'eslint-plugin-vue'
import {
  withVueTs,
  vueTsConfigs,
} from '@vue/eslint-config-typescript'

export default withVueTs(
  { rootDir: import.meta.dirname },
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      '.tmp/**',
      // 第三方固定版本 vendor 源码（Agent Robot Avatar，MIT）：不参与项目 lint，
      // 不修改第三方源码；其版权信息保留在 src/vendor/agent-robot-avatar/LICENSE。
      'src/vendor/**',
    ],
  },
  pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,
)
