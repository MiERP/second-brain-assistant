"use client";

import React, { useState, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, AlertCircle, FileText, Loader } from "lucide-react";

interface PDFViewerProps {
  documentInfo: {
    id: string;
    filename: string;
    page?: number;
    highlightText?: string;
  } | null;
}

export default function PDFViewer({ documentInfo }: PDFViewerProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(15);
  const [zoom, setZoom] = useState(100);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const [highlights, setHighlights] = useState<{ left: number; top: number; width: number; height: number }[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<any>(null);

  // Sync page from parent info
  useEffect(() => {
    if (documentInfo && documentInfo.page) {
      setCurrentPage(documentInfo.page);
    }
  }, [documentInfo]);

  // Load PDF document on source changes
  useEffect(() => {
    if (!documentInfo) {
      setPdfDoc(null);
      return;
    }

    let active = true;
    setIsPdfLoading(true);
    setHighlights([]);

    const loadPDF = async () => {
      try {
        const fileUrl = `http://localhost:8000/workspaces/default/documents/${documentInfo.id}/file`;
        
        // Try checking if backend serves the file. If not, fallback to mockup
        const testRes = await fetch(fileUrl, { method: "HEAD" }).catch(() => null);
        if (!testRes || !testRes.ok) {
          if (active) {
            setPdfDoc(null);
            setIsPdfLoading(false);
          }
          return;
        }

        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

        const loadingTask = pdfjs.getDocument({ url: fileUrl });
        const doc = await loadingTask.promise;

        if (active) {
          setPdfDoc(doc);
          setTotalPages(doc.numPages);
          setIsPdfLoading(false);
        }
      } catch (err) {
        console.warn("Failed to load PDF, falling back to simulated document view:", err);
        if (active) {
          setPdfDoc(null);
          setIsPdfLoading(false);
        }
      }
    };

    loadPDF();

    return () => {
      active = false;
    };
  }, [documentInfo]);

  // Render canvas page and highlights when pdfDoc, page, or zoom changes
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;

    let active = true;

    const renderPage = async () => {
      try {
        const page = await pdfDoc.getPage(currentPage);
        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext("2d");
        if (!context) return;

        // Cancel previous render task
        if (renderTaskRef.current) {
          renderTaskRef.current.cancel();
        }

        const viewport = page.getViewport({ scale: zoom / 100 });
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
          canvasContext: context,
          viewport: viewport,
        };

        const renderTask = page.render(renderContext);
        renderTaskRef.current = renderTask;
        await renderTask.promise;

        // Find highlights in text content
        if (documentInfo?.highlightText && active) {
          const textContent = await page.getTextContent();
          const query = documentInfo.highlightText.toLowerCase();
          const matches = textContent.items.filter((item: any) =>
            item.str && item.str.toLowerCase().includes(query)
          );

          const newHighlights = matches.map((item: any) => {
            const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
            const itemHeight = item.height * (zoom / 100);
            return {
              left: x,
              top: y - itemHeight,
              width: item.width * (zoom / 100),
              height: itemHeight || 12,
            };
          });

          setHighlights(newHighlights);
        }
      } catch (err: any) {
        if (err.name !== "RenderingCancelledException") {
          console.error("PDF rendering error:", err);
        }
      }
    };

    renderPage();

    return () => {
      active = false;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }
    };
  }, [pdfDoc, currentPage, zoom, documentInfo]);

  const handlePrevPage = () => {
    if (currentPage > 1) setCurrentPage(currentPage - 1);
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) setCurrentPage(currentPage + 1);
  };

  // Simulated content fallback
  const getSimulatedPageContent = (page: number) => {
    if (documentInfo?.filename.includes("tesla")) {
      if (page === 12) {
        return {
          title: "Chương 3: Tối ưu hóa Cell pin 4680 của Tesla",
          text: "Trong nỗ lực giảm chi phí sản xuất và nâng cao hiệu suất vận hành, Tesla đã công bố cell pin hình trụ 4680 mới. Công nghệ pin 4680 mang lại sự tăng trưởng 16% về cự ly di chuyển (range) chỉ nhờ sự tối ưu hóa dạng hình học (form factor). Thiết kế tabless (không vấu cực) giúp giảm quãng đường dịch chuyển của electron, giảm điện trở trong và giải quyết hiệu quả vấn đề tỏa nhiệt của pin hình trụ cỡ lớn. Quy trình sản xuất cực khô (dry electrode process) cũng hứa hẹn giảm 50% chi phí đầu tư nhà máy.",
        };
      }
      return {
        title: `Báo cáo Kỹ thuật Tesla - Trang ${page}`,
        text: `Nội dung tài liệu kỹ thuật về xe điện Tesla liên quan đến cấu trúc khung xe gầm liền khối (Mega Casting) và tích hợp khối pin trực tiếp vào sàn xe (Structural Battery Pack). Phần này trình bày các chỉ số chịu lực cơ học, hiệu quả tối ưu hóa trọng lượng xe lên tới 10% và khả năng giảm số lượng chi tiết lắp ráp từ 70 chi tiết xuống còn 1 chi tiết đúc nguyên khối duy nhất.`,
      };
    }

    if (documentInfo?.filename.includes("byd")) {
      return {
        title: `Công nghệ Blade Battery của BYD - Trang ${page}`,
        text: `Blade Battery là công nghệ pin Lithium Iron Phosphate (LFP) được BYD giới thiệu vào năm 2020. Thiết kế cell pin siêu dài giống hình lưỡi dao giúp xếp khít trực tiếp vào pack pin (Cell-to-Pack), nâng cao mật độ năng lượng thể tích lên tới 50% so với cấu trúc pin LFP truyền thống. Điểm vượt trội lớn nhất của pin Blade là khả năng vượt qua bài kiểm tra châm kim (nail penetration test) khắc nghiệt mà không sinh khói hay bốc cháy, duy trì mức nhiệt ổn định dưới 60 độ C.`,
      };
    }

    return {
      title: documentInfo ? `${documentInfo.filename} - Trang ${page}` : "Tài liệu mẫu",
      text: "Đang tải nội dung văn bản gốc từ bộ nhớ dữ liệu RAG cục bộ. Hệ thống sử dụng Docling Reader để trích xuất cấu trúc văn bản và đồng bộ tọa độ trang.",
    };
  };

  const pageContent = getSimulatedPageContent(currentPage);

  return (
    <div className="flex flex-col h-full bg-muted/20 border-r border-border select-none">
      {/* Control bar */}
      <div className="flex items-center justify-between px-6 py-2.5 border-b border-border bg-card/25 text-xs">
        <div className="flex items-center gap-1.5 overflow-hidden">
          <FileText className="h-4 w-4 text-primary flex-shrink-0" />
          <span className="font-semibold truncate max-w-[150px]">
            {documentInfo ? documentInfo.filename : "Chưa chọn tài liệu"}
          </span>
        </div>

        {documentInfo ? (
          <div className="flex items-center gap-4">
            {/* Page switching */}
            <div className="flex items-center gap-2">
              <button
                onClick={handlePrevPage}
                disabled={currentPage <= 1}
                className="p-1 hover:bg-muted border border-border/60 rounded disabled:opacity-30 disabled:hover:bg-transparent transition-colors cursor-pointer"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="font-medium">
                Trang {currentPage} / {totalPages}
              </span>
              <button
                onClick={handleNextPage}
                disabled={currentPage >= totalPages}
                className="p-1 hover:bg-muted border border-border/60 rounded disabled:opacity-30 disabled:hover:bg-transparent transition-colors cursor-pointer"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Zoom */}
            <div className="flex items-center gap-1.5 border-l border-border pl-4">
              <button
                onClick={() => setZoom(Math.max(50, zoom - 10))}
                className="p-1 hover:bg-muted rounded transition-colors cursor-pointer"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              <span className="w-8 text-center">{zoom}%</span>
              <button
                onClick={() => setZoom(Math.min(200, zoom + 10))}
                className="p-1 hover:bg-muted rounded transition-colors cursor-pointer"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Main Document Viewer Container */}
      <div className="flex-1 overflow-auto p-6 flex justify-center items-start" ref={containerRef}>
        {isPdfLoading ? (
          <div className="flex flex-col items-center justify-center m-auto">
            <Loader className="h-8 w-8 text-primary animate-spin mb-2" />
            <span className="text-xs text-muted-foreground">Đang mở tài liệu PDF...</span>
          </div>
        ) : documentInfo ? (
          pdfDoc ? (
            /* Real PDF Canvas view with bounding box highlight overlays */
            <div className="relative border border-border/60 shadow-lg rounded-md overflow-hidden bg-card transition-all">
              <canvas ref={canvasRef} className="block" />
              
              {/* Highlight overlays */}
              {highlights.map((hl, i) => (
                <div
                  key={i}
                  className="absolute bg-yellow-400/25 dark:bg-yellow-400/20 border-b-2 border-yellow-500/60 rounded-sm animate-pulse"
                  style={{
                    left: `${hl.left}px`,
                    top: `${hl.top}px`,
                    width: `${hl.width}px`,
                    height: `${hl.height}px`,
                  }}
                />
              ))}
            </div>
          ) : (
            /* Simulated Paper Page mockup if file is not physically on backend */
            <div
              style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top center" }}
              className="w-full max-w-[650px] aspect-[1/1.414] bg-card text-foreground border border-border/60 shadow-lg rounded-md p-8 md:p-12 flex flex-col justify-between transition-transform duration-150 relative animate-fade-in"
            >
              {/* Page Header */}
              <div className="border-b border-border/40 pb-2 text-[10px] text-muted-foreground uppercase tracking-wider flex justify-between">
                <span>Second Brain Assistant - Preview</span>
                <span>{documentInfo.filename}</span>
              </div>

              {/* Page Content */}
              <div className="flex-1 py-8 flex flex-col gap-4 text-justify">
                <h3 className="text-base font-bold text-foreground mb-4 tracking-tight">
                  {pageContent.title}
                </h3>
                
                <div className="text-xs leading-relaxed text-foreground/80 space-y-4">
                  {/* Highlight specific citation text if selected */}
                  {documentInfo.page === currentPage && documentInfo.highlightText ? (
                    <p>
                      {pageContent.text.split(documentInfo.highlightText).map((part, i, arr) => (
                        <React.Fragment key={i}>
                          {part}
                          {i < arr.length - 1 && (
                            <span className="bg-yellow-400/35 dark:bg-yellow-400/20 px-1 border-b border-yellow-500/50 rounded-sm font-semibold transition-all duration-300">
                              {documentInfo.highlightText}
                            </span>
                          )}
                        </React.Fragment>
                      ))}
                    </p>
                  ) : (
                    <p>{pageContent.text}</p>
                  )}
                </div>
              </div>

              {/* Page Footer */}
              <div className="border-t border-border/40 pt-2 text-[10px] text-muted-foreground flex justify-between">
                <span>Nguồn tài liệu trích dẫn RAG (Simulated)</span>
                <span>Trang {currentPage}</span>
              </div>
            </div>
          )
        ) : (
          /* Empty state */
          <div className="flex flex-col items-center justify-center text-center max-w-sm m-auto">
            <AlertCircle className="h-8 w-8 text-muted-foreground mb-2 animate-pulse" />
            <h4 className="text-sm font-semibold mb-1">Chưa có tài liệu hiển thị</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Hãy bấm vào liên kết trích dẫn dạng <code className="px-1.5 py-0.5 bg-muted rounded border border-border text-[10px] text-primary font-bold">[1]</code> trong khung chat hoặc chọn tài liệu trong sidebar để xem trước văn bản gốc.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
