<template>
  <div class="notes-folder-content col scroll q-px-md q-pb-xl">
    <div class="notes-folder-grid"><slot /></div>
  </div>
</template>
<style scoped>
.notes-folder-content {
  min-height: 0;
}
.notes-folder-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 16px;
  padding-bottom: 88px;
}
.notes-folder-grid :slotted(.notes-folder-item) {
  min-height: 144px;
  align-self: start;
  border-radius: 8px;
  padding: 16px 8px;
}
.notes-folder-grid :deep(.notes-folder-name) {
  white-space: normal;
  overflow-wrap: anywhere;
  line-height: 1.4;
  text-align: center;
  font-weight: 400;
}
</style>
