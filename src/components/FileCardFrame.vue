<template>
  <div class="file-card-frame">
    <slot name="header" />
    <slot />
  </div>
</template>

<style scoped>
.file-card-frame {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid rgba(128, 128, 128, 0.2);
  border-radius: 4px;
  overflow: hidden;
}
</style>
