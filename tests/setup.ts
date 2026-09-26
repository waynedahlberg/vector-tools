// The converter parses SVG with the browser's DOMParser; xmldom provides one in Node.
import { DOMParser } from "@xmldom/xmldom";

(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;
