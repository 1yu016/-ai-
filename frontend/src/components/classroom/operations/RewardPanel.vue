<script setup lang="ts">
defineProps<{ awardTotal: number }>()
</script>

<template>
  <section class="panel growth">
    <h2>班级成长乐园</h2>
    <div class="tree">🌳</div>
    <strong>{{ awardTotal }} 朵小红花</strong>
    <p class="muted">每一次合作、回答和专注都值得被看见。</p>
  </section>
</template>

<style scoped>
.panel {
  border: 1px solid #f0ddce;
  border-radius: 18px;
  background: #fffdf9;
  padding: 20px;
  box-shadow: 0 10px 28px #b9795114;
}
.panel h2 {
  margin: 0 0 6px;
}
.muted {
  color: #9a7e6e;
  line-height: 1.6;
}
.growth {
  text-align: center;
}
.tree {
  font-size: 68px;
  padding: 14px;
}
</style>
