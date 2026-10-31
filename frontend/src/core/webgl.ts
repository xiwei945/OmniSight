// WebGL 可用性探测。3D 键盘是增强视图——跑不起来（老机器、软件渲染被禁、无 GPU 的
// 虚拟机）就不该把整块键盘变成一张空白画布，而要退回平面视图。这个探测在**选择默认
// 视图**时跑一次，因此它必须便宜、且不真正建一个渲染上下文。
//
// 探测用 `webgl2` 优先、退回 `webgl`：three r186 的 WebGLRenderer 两者都支持。
export function webglAvailable(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const context =
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl');
    return Boolean(context);
  } catch {
    return false;
  }
}
