/*
 * 页面入口。
 *
 * 初始化 GomokuGame。所有对局逻辑在 game.js，棋盘绘制在 board-ui.js。
 */

import { GomokuGame } from "./game.js";

window.addEventListener("DOMContentLoaded", async () => {
    const canvas = document.getElementById("board-canvas");
    const game = new GomokuGame(canvas);
    try {
        await game.init();
    } catch (error) {
        console.error(error);
        document.getElementById("status").textContent = `AI 初始化失败：${error.message || error}`;
    }
});
