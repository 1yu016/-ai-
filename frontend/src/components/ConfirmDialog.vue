<script setup lang="ts">
withDefaults(
  defineProps<{
    modelValue: boolean
    title: string
    message: string
    confirmLabel?: string
    cancelLabel?: string
    danger?: boolean
    busy?: boolean
  }>(),
  { confirmLabel: '确认', cancelLabel: '取消', danger: false, busy: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: boolean]; confirm: []; cancel: [] }>()

function cancel(): void {
  emit('update:modelValue', false)
  emit('cancel')
}

function confirm(): void {
  emit('confirm')
}
</script>

<template>
  <Teleport to="body">
    <div v-if="modelValue" class="confirm-mask" @click.self="!busy && cancel()">
      <section class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-confirm-title">
        <h2 id="workspace-confirm-title">{{ title }}</h2>
        <p>{{ message }}</p>
        <div class="confirm-actions">
          <button type="button" class="cancel" :disabled="busy" @click="cancel">{{ cancelLabel }}</button>
          <button type="button" class="confirm" :class="{ danger }" :disabled="busy" @click="confirm">
            {{ busy ? '处理中…' : confirmLabel }}
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.confirm-mask{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:20px;background:#4d382e66;backdrop-filter:blur(4px)}.confirm-dialog{width:min(440px,100%);box-sizing:border-box;padding:25px;border:1px solid #efd9c8;border-radius:20px;background:#fffdf9;color:#60483e;box-shadow:0 24px 70px #40251935}.confirm-dialog h2{margin:0 0 10px;font-size:21px}.confirm-dialog p{margin:0;color:#876b5d;line-height:1.7;white-space:pre-wrap}.confirm-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:24px}.confirm-actions button{border-radius:12px;padding:10px 17px;font:inherit;font-weight:700;cursor:pointer}.confirm-actions button:disabled{cursor:not-allowed;opacity:.6}.cancel{border:1px solid #efd9c8;background:#fff;color:#876b5d}.confirm{border:0;background:#eb956b;color:#fff}.confirm.danger{background:#d85d57}
</style>
