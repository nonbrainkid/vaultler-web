import { Config } from "@remotion/cli/config";

// Пиксель-арт: любое сглаживание при масштабировании превращает спрайт сейфа в кашу.
Config.setChromiumOpenGlRenderer("angle");

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
// CRF 18 — визуально без потерь для плоских заливок пиксель-арта.
Config.setCrf(18);
