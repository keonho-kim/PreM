// Purpose: Compose original screenshots into four labeled review sheets.
// Pattern: Native AppKit image composition without altering captured UI content.
// Usage: swift mock/helpers/compose.swift mock/captures/folio
// Related: design/refract.tokens.json, mock/helpers/capture.cjs, mock/captures/.
import AppKit
import Foundation

let projectRoot = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
let capturesRoot = projectRoot.appendingPathComponent("mock/captures", isDirectory: true).resolvingSymlinksInPath().standardizedFileURL
let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true).resolvingSymlinksInPath().standardizedFileURL
guard root.pathComponents.starts(with: capturesRoot.pathComponents) else {
    fatalError("Capture output must stay inside this project's mock/captures directory.")
}
let source = try Data(contentsOf: projectRoot.appendingPathComponent("design/refract.tokens.json"))
let config = try JSONSerialization.jsonObject(with: source) as! [String: Any]
let tokens = config["properties"] as! [String: String]
func themeColor(_ name: String) -> NSColor {
    guard let value = tokens[name], value.count == 7, value.first == "#", let rgb = UInt32(value.dropFirst(), radix: 16) else {
        fatalError("Contact sheets need an opaque canonical hex color: " + name)
    }
    return NSColor(srgbRed: Double((rgb >> 16) & 255) / 255, green: Double((rgb >> 8) & 255) / 255, blue: Double(rgb & 255) / 255, alpha: 1)
}
let groups: [(String, String, [(String, String)])] = [
    ("01-projects", "프로젝트와 문서", [
        ("01  프로젝트 목록", "projects-project-platform"),
        ("02  프로젝트 개요", "overview-project-platform"),
        ("03  원본 문서", "documents-project-platform"),
        ("04  프로젝트 가이드", "guide-project-platform")
    ]),
    ("02-content", "콘텐츠와 프레젠테이션", [
        ("05  목차와 콘텐츠 매핑", "outline-project-platform"),
        ("06  레퍼런스 탐색", "references-project-platform"),
        ("07  템플릿 탐색", "templates-project-platform"),
        ("08  PPT 생성과 목록", "presentations-project-platform")
    ]),
    ("03-editor", "편집과 모델 설정", [
        ("09  PPT 편집기", "editor-project-platform-deck-deck1"),
        ("10  작업 이력", "history-project-platform"),
        ("11  LLM Provider", "admin-project-platform-tab-providers"),
        ("12  모델 라우팅", "admin-project-platform-tab-routing")
    ]),
    ("04-admin", "공용 라이브러리와 운영", [
        ("13  Reference Library", "space-project-platform-tab-references"),
        ("14  Template Library", "space-project-platform-tab-templates"),
        ("15  Workflow Monitor", "admin-project-platform-tab-monitor"),
        ("16  시스템 상태", "admin-project-platform-tab-system")
    ])
]

let width = 2000.0, pad = 28.0, gap = 28.0, labelHeight = 48.0
let columnWidth = (width - pad * 2 - gap) / 2
let background = themeColor("--color-paper")
let textColor = themeColor("--color-ink")
let labelAttributes: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: 24, weight: .medium), .foregroundColor: textColor
]
let headingAttributes: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: 32, weight: .semibold), .foregroundColor: textColor
]

for (stem, title, entries) in groups {
    let images = entries.map { entry -> NSImage in
        let file = root.appendingPathComponent("screens/PuPuTyX--view-\(entry.1)-desktop.png")
        guard let image = NSImage(contentsOf: file) else { fatalError("Missing screenshot: \(file.path)") }
        return image
    }
    let heights = images.map { columnWidth * $0.size.height / $0.size.width }
    let rowHeights = [max(heights[0], heights[1]), max(heights[2], heights[3])]
    let headerHeight = 84.0
    let height = ceil(headerHeight + rowHeights.reduce(0, +) + labelHeight * 2 + gap + pad)
    guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(width), pixelsHigh: Int(height), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
          let context = NSGraphicsContext(bitmapImageRep: bitmap) else { fatalError("Unable to create canvas") }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    context.imageInterpolation = .high
    background.setFill()
    NSRect(x: 0, y: 0, width: width, height: height).fill()
    ("PuPuTyX  /  \(title)" as NSString).draw(at: NSPoint(x: pad, y: height - 56), withAttributes: headingAttributes)
    var rowTop = headerHeight
    for row in 0..<2 {
        for column in 0..<2 {
            let index = row * 2 + column
            let x = pad + Double(column) * (columnWidth + gap)
            (entries[index].0 as NSString).draw(at: NSPoint(x: x, y: height - rowTop - 34), withAttributes: labelAttributes)
            images[index].draw(in: NSRect(x: x, y: height - rowTop - labelHeight - heights[index], width: columnWidth, height: heights[index]), from: .zero, operation: .copy, fraction: 1)
        }
        rowTop += labelHeight + rowHeights[row] + gap
    }
    NSGraphicsContext.restoreGraphicsState()
    let out = root.appendingPathComponent("\(stem).png")
    try bitmap.representation(using: .png, properties: [:])!.write(to: out)
    print("\(out.path)  \(Int(width)) x \(Int(height))")
}
