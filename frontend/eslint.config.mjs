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
    ],
  },
  pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,
)
