<script setup lang="ts">
import { computed } from 'vue'
import { useData } from 'vitepress'

const { localeIndex } = useData()
const isQt = computed(() => localeIndex.value === 'qt')
</script>

<template>
  <div v-if="isQt" class="webui-notice">
    <strong>本教程针对肥牛.exe。</strong>
    窗口标题类似 <code>My-Neuro (本地)</code>，左侧栏换页，保存按钮是「更新配置」。
    浏览器里的「My Neuro 控制中心」请看
    <a href="/">WebUI 文档</a>。
  </div>
  <div v-else class="webui-notice">
    <strong>本教程针对 WebUI 版本。</strong>
    指用 <code>启动 WebUI 控制面板.bat</code> 打开的浏览器「My Neuro 控制中心」。
    若你打开的是 <code>肥牛.exe</code>，请看
    <a href="/qt/">肥牛.exe 教程</a>。
    安装包和更旧截图仍在
    <a href="http://mynewbot.com/tutorials" target="_blank" rel="noopener">官网教程</a>。
  </div>
</template>
