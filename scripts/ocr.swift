// Lee el texto que encuentre en una imagen con el OCR de macOS (Vision): una línea por texto, "confianza<TAB>texto".
// Lo usa scripts/generar-personaje.py, que lo compila una sola vez en .venv-rembg/bin/ocr-texto (requiere swiftc).
import Foundation
import Vision
import AppKit

let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard let img = NSImage(contentsOf: url),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    FileHandle.standardError.write("no pude abrir \(url.path)\n".data(using: .utf8)!)
    exit(1)
}
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.usesLanguageCorrection = false
try VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
for t in (req.results ?? []).compactMap({ $0.topCandidates(1).first }) {
    print(String(format: "%.2f\t%@", t.confidence, t.string))
}
