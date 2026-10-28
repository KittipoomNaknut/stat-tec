import './style.css';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app root element not found');

const title = document.createElement('h1');
title.className = 'boot-title';
title.textContent = 'STAT_TEC';
root.append(title);
