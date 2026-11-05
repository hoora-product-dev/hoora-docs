import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://test.hoora.local",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
