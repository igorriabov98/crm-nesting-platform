"use client"

import { Fragment, useState } from "react"
import { FileDown, FileText, Loader2, Package } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type DocumentType = "specification" | "invoice" | "packing_list" | "quality_control" | "all"

interface DocumentGenerationButtonsProps {
  machineId: string
  specificationNumber?: string | null
  specificationDate?: string | null
  deliveryBasisType?: string | null
}

const DOCUMENT_OPTIONS: Array<{
  type: DocumentType
  label: string
  kind: "pdf" | "zip"
}> = [
  { type: "specification", label: "Specification (PDF)", kind: "pdf" },
  { type: "invoice", label: "Invoice (PDF)", kind: "pdf" },
  { type: "packing_list", label: "Packing List (PDF)", kind: "pdf" },
  { type: "quality_control", label: "Контроль качества (PDF)", kind: "pdf" },
  { type: "all", label: "Все документы (ZIP)", kind: "zip" },
]

function getSafeFilePart(value: string) {
  return value.trim().replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_") || "document"
}

function getFileName(type: DocumentType, documentNumber: string) {
  const safeDocumentNumber = getSafeFilePart(documentNumber)

  switch (type) {
    case "specification":
      return `Specification_${safeDocumentNumber}.pdf`
    case "invoice":
      return `Invoice_${safeDocumentNumber}.pdf`
    case "packing_list":
      return `PackingList_${safeDocumentNumber}.pdf`
    case "quality_control":
      return `QualityControl_${safeDocumentNumber}.pdf`
    case "all":
      return `Documents_${safeDocumentNumber}.zip`
  }
}

async function getErrorMessage(response: Response) {
  try {
    const payload = (await response.json()) as { error?: unknown }
    if (typeof payload.error === "string" && payload.error.trim()) {
      return payload.error
    }
  } catch {
    // Some server errors may not be JSON. Fall back to the generic message.
  }

  return "Не удалось сгенерировать документы"
}

export function DocumentGenerationButtons({
  machineId,
  specificationNumber,
  specificationDate,
  deliveryBasisType,
}: DocumentGenerationButtonsProps) {
  const [loadingType, setLoadingType] = useState<DocumentType | null>(null)
  const isLoading = loadingType !== null

  const handleGenerate = async (type: DocumentType) => {
    const number = specificationNumber?.trim() || ""
    const date = specificationDate?.trim() || ""

    if (!number || !date || !deliveryBasisType) {
      toast.error("Заполните данные документов во вкладке Настройки машины")
      return
    }

    setLoadingType(type)

    try {
      const response = await fetch("/api/documents/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ machineId, type }),
      })

      if (!response.ok) {
        throw new Error(await getErrorMessage(response))
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")

      link.href = url
      link.download = getFileName(type, number)
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Не удалось сгенерировать документы"
      )
    } finally {
      setLoadingType(null)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            className="bg-white border-[#E8ECF0] text-[#374151] hover:bg-[#F8F9FA] hover:text-[#1B3A6B]"
            aria-busy={isLoading}
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <FileDown className="w-4 h-4 mr-2" />
            )}
            Документы
          </Button>
        }
      />

      <DropdownMenuContent
        align="end"
        className="w-64 border-[#E8ECF0] bg-white text-[#374151]"
      >
        {DOCUMENT_OPTIONS.map((option) => {
          const isActive = loadingType === option.type
          const Icon = option.kind === "zip" ? Package : FileText

          return (
            <Fragment key={option.type}>
              {option.type === "all" && <DropdownMenuSeparator className="bg-[#E8ECF0]" />}
              <DropdownMenuItem
                disabled={isLoading}
                onClick={() => handleGenerate(option.type)}
                className="h-9 cursor-pointer gap-2 px-2.5 py-2 text-sm text-[#374151] focus:bg-[#F8F9FA] focus:text-[#1B3A6B]"
              >
                {isActive ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Icon className="h-4 w-4" />
                )}
                <span>{option.label}</span>
              </DropdownMenuItem>
            </Fragment>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
