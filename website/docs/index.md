---
layout: home

title: 桌面课表
titleTemplate: 让一天的课程，在桌面上缓慢流动

hero:
  name: 桌面课表
  text: 让一天的课程，在桌面上缓慢流动
  tagline: 一个面向 Windows 的本地桌面课表组件。导入学校课表后，在桌面查看当天课程、下一节课和教学周。
  image:
    src: /mark.svg
    alt: 桌面课表图标
  actions:
    - theme: brand
      text: 下载最新版
      link: https://github.com/Tyr1onX/desktop-course-widget/releases/latest
    - theme: alt
      text: 开始使用
      link: /guide/getting-started
    - theme: alt
      text: 查看源码
      link: https://github.com/Tyr1onX/desktop-course-widget

features:
  - icon: 🗓️
    title: 今天先于整张表
    details: 桌面组件突出当天课程、当前状态与下一节课，不必反复打开教务系统。
  - icon: 📚
    title: 多课表管理
    details: 每次导入生成独立课表，可以切换、激活和删除不同学期或不同版本的安排。
  - icon: ✏️
    title: 自由编辑课程
    details: 支持新增、修改和删除课程，并配置周次、地点、教师、颜色与多个上课时间。
  - icon: ⏱️
    title: 动态作息
    details: 可根据学校实际安排设置每天的课程节数，以及每一节课的开始与结束时间。
  - icon: 📄
    title: Excel 本地导入
    details: 选择教务系统导出的 .xlsx 文件，在本机解析并预览后再写入课表。
  - icon: 🔒
    title: 本地优先
    details: 课表和设置保存在电脑本地，应用不会把 Excel 文件或课程数据上传到服务器。
---

## 从一张表，变成桌面上的一天

传统课表告诉你一周有什么课；桌面课表更关心此刻正在发生什么、下一节是什么，以及今天还剩多少时间。

当前版本仍处于预发布测试阶段。不同学校导出的 Excel 结构可能存在差异，遇到无法识别的课表时，可以在 GitHub Issue 中反馈经过隐私处理的样例结构和报错信息。

<div class="home-note">
  <strong>当前支持：</strong>Windows、XLSX 导入、多课表、课程编辑、动态作息、系统托盘与本地数据存储。
</div>
