/*
 * 页面入口。
 *
 * 初始化 GomokuGame。所有对局逻辑在 game.js，棋盘绘制在 board-ui.js。
 */

import { GomokuGame } from "./game.js";

window.addEventListener("DOMContentLoaded", async () => {
    /*
     * 页面唯一入口。
     *
     * 这里不直接写任何规则逻辑，只创建 GomokuGame。
     * 如果 Wasm 或 Worker 初始化失败，错误会显示到底部状态栏，方便用户知道原因。
     */
    const canvas = document.getElementById("board-canvas");
    const game = new GomokuGame(canvas);
    try {
        await game.init();
    } catch (error) {
        console.error(error);
        document.getElementById("status").textContent = `AI 初始化失败：${error.message || error}`;
    }
});
