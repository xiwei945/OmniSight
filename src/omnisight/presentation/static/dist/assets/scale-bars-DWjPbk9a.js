import { a as bar, c as niceMax, o as cssFont, s as hatchPattern, t as drawTimeAxis } from "./axis-DY4SNg7k.js";
//#region frontend/src/charts/scale-bars.ts
var PAD = {
	top: 10,
	right: 8,
	bottom: 20,
	left: 52
};
function scaleBarsDraw(options) {
	const { format, accent = "keys" } = options;
	return (ctx, box, data, palette) => draw(ctx, box, data, palette, format, accent);
}
function scaleBarsDescribe(options) {
	const { format } = options;
	return (data) => {
		const buckets = data?.buckets || [];
		if (!buckets.length) return null;
		return {
			caption: data.caption || "",
			summary: data.summary || "",
			columns: ["时间", data.valueLabel],
			rows: buckets.map((item) => [String(item.label ?? item.bucket ?? ""), item.gap ? "无记录" : format(item.value || 0)])
		};
	};
}
function draw(ctx, box, data, palette, format, accent) {
	const buckets = data.buckets || [];
	if (!buckets.length) return;
	const plot = {
		x: PAD.left,
		y: PAD.top,
		w: Math.max(1, box.width - PAD.left - PAD.right),
		h: Math.max(1, box.height - PAD.top - PAD.bottom)
	};
	const max = niceMax(Math.max(...buckets.map((item) => item.value || 0)));
	const slot = plot.w / buckets.length;
	const width = Math.max(1, Math.min(slot - 2, 24));
	const hatch = hatchPattern(ctx, palette.strong);
	const fill = accent === "time" ? palette.time : palette.keys;
	ctx.font = cssFont(11);
	ctx.strokeStyle = palette.grid;
	ctx.fillStyle = palette.faint;
	ctx.textAlign = "right";
	ctx.textBaseline = "middle";
	for (let step = 0; step <= 2; step += 1) {
		const y = plot.y + plot.h - plot.h * step / 2;
		ctx.beginPath();
		ctx.moveTo(plot.x, Math.round(y) + .5);
		ctx.lineTo(plot.x + plot.w, Math.round(y) + .5);
		ctx.stroke();
		ctx.fillText(format(max * step / 2), plot.x - 6, y);
	}
	buckets.forEach((item, index) => {
		const centre = plot.x + slot * (index + .5);
		const x = centre - width / 2;
		box.hits.push({
			x: centre - slot / 2,
			y: plot.y,
			w: slot,
			h: plot.h,
			payload: {
				label: item.label ?? item.bucket,
				gap: item.gap,
				reading: {
					label: data.valueLabel,
					text: format(item.value || 0)
				}
			}
		});
		if (item.gap) {
			if (hatch) ctx.fillStyle = hatch;
			ctx.fillRect(x, plot.y, width, plot.h);
			return;
		}
		const value = item.value || 0;
		if (value <= 0) return;
		const height = Math.max(2, value / max * plot.h);
		ctx.fillStyle = fill;
		bar(ctx, x, plot.y + plot.h - height, width, height);
	});
	drawTimeAxis(ctx, buckets.map((item) => String(item.label ?? "")), plot, plot.y + plot.h + 5, palette.faint);
}
//#endregion
export { scaleBarsDraw as n, scaleBarsDescribe as t };
