"use client"

import { Fragment, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { FileDown, FileText, Loader2, Package } from "lucide-react"
import { toast } from "sonner"

import { updateMachineDocumentFields } from "@/app/(protected)/sales-plan/actions"
import { getNextSpecificationNumber } from "@/lib/actions/contracts"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { ContractSelectField } from "@/components/features/contracts/ContractSelectField"

type DocumentType = "specification" | "invoice" | "packing_list" | "quality_control" | "all"

interface DocumentGenerationButtonsProps {
  machineId: string
  clientId?: string | null
  contractId?: string | null
  specificationNumber?: string | null
  specificationDate?: string | null
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

function todayDateOnly() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function dateOnly(date: Date | undefined) {
  if (!date) return ""
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

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
  clientId,
  contractId: initialContractId,
  specificationNumber,
  specificationDate,
}: DocumentGenerationButtonsProps) {
  const router = useRouter()
  const [loadingType, setLoadingType] = useState<DocumentType | null>(null)
  const [selectedType, setSelectedType] = useState<DocumentType | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [contractId, setContractId] = useState<string | null>(initialContractId || null)
  const [documentNumber, setDocumentNumber] = useState(specificationNumber || "")
  const [documentDate, setDocumentDate] = useState(specificationDate || todayDateOnly())
  const [isNumberDirty, setIsNumberDirty] = useState(Boolean(specificationNumber?.trim()))
  const [autoNumber, setAutoNumber] = useState("")
  const isLoading = loadingType !== null
  const selectedOption = useMemo(
    () => DOCUMENT_OPTIONS.find((option) => option.type === selectedType) || null,
    [selectedType],
  )

  useEffect(() => {
    if (isDialogOpen) return
    setContractId(initialContractId || null)
    setDocumentNumber(specificationNumber || "")
    setDocumentDate(specificationDate || todayDateOnly())
    setIsNumberDirty(Boolean(specificationNumber?.trim()))
    setAutoNumber("")
  }, [initialContractId, isDialogOpen, specificationDate, specificationNumber])

  useEffect(() => {
    if (!isDialogOpen || !clientId || isNumberDirty) return
    if (documentNumber.trim() && documentNumber !== autoNumber) return

    let cancelled = false
    getNextSpecificationNumber({
      client_id: clientId,
      contract_id: contractId || null,
    }).then((result) => {
      if (cancelled) return
      if (result.error) {
        toast.error(result.error)
        return
      }
      if (result.data) {
        setAutoNumber(result.data)
        setDocumentNumber(result.data)
      }
    })

    return () => {
      cancelled = true
    }
  }, [autoNumber, clientId, contractId, documentNumber, isDialogOpen, isNumberDirty])

  const openDialog = (type: DocumentType) => {
    setSelectedType(type)
    setContractId(initialContractId || null)
    setDocumentNumber(specificationNumber || "")
    setDocumentDate(specificationDate || todayDateOnly())
    setIsNumberDirty(Boolean(specificationNumber?.trim()))
    setAutoNumber("")
    setIsDialogOpen(true)
  }

  const handleGenerate = async () => {
    if (!selectedType) return

    const number = documentNumber.trim()
    const date = documentDate.trim()

    if (!number) {
      toast.error("Укажите номер инвойса / спецификации")
      return
    }

    if (!date) {
      toast.error("Укажите дату документов")
      return
    }

    setLoadingType(selectedType)

    try {
      const saveResult = await updateMachineDocumentFields(machineId, {
        contract_id: contractId,
        specification_number: number,
        specification_date: date,
      })

      if (!saveResult.success) {
        throw new Error(saveResult.error || "Не удалось сохранить данные документов")
      }

      const response = await fetch("/api/documents/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ machineId, type: selectedType }),
      })

      if (!response.ok) {
        throw new Error(await getErrorMessage(response))
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")

      link.href = url
      link.download = getFileName(selectedType, number)
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)

      setIsDialogOpen(false)
      router.refresh()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Не удалось сгенерировать документы"
      )
    } finally {
      setLoadingType(null)
    }
  }

  return (
    <>
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
                  onClick={() => openDialog(option.type)}
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

      <Dialog open={isDialogOpen} onOpenChange={(open) => !isLoading && setIsDialogOpen(open)}>
        <DialogContent className="sm:max-w-xl bg-white border-[#E8ECF0] text-[#1B3A6B]">
          <DialogHeader>
            <DialogTitle>Данные документов</DialogTitle>
          </DialogHeader>

          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              void handleGenerate()
            }}
          >
            <div className="grid gap-2">
              <Label className="text-sm font-medium text-[#374151]">Контракт</Label>
              <ContractSelectField
                clientId={clientId}
                value={contractId}
                onChange={setContractId}
              />
            </div>

            <div className="grid gap-2">
              <Label className="text-sm font-medium text-[#374151]">Номер инвойса / спецификации *</Label>
              <Input
                value={documentNumber}
                onChange={(event) => {
                  setDocumentNumber(event.target.value)
                  setIsNumberDirty(true)
                }}
                className="bg-white border-[#E8ECF0] text-[#1B3A6B]"
              />
            </div>

            <div className="grid gap-2">
              <Label className="text-sm font-medium text-[#374151]">Дата документов *</Label>
              <DatePicker
                value={documentDate ? new Date(documentDate) : undefined}
                onChange={(date) => setDocumentDate(dateOnly(date))}
                placeholder="Выберите дату"
                displayFormat="dd.MM.yyyy"
                allowClear={false}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" disabled={isLoading} onClick={() => setIsDialogOpen(false)}>
                Отмена
              </Button>
              <LoadingButton
                type="submit"
                loading={isLoading}
                disabled={!selectedType || !documentNumber.trim() || !documentDate.trim()}
                className="gap-2 bg-[#1B3A6B] text-white hover:bg-[#152D54]"
              >
                {selectedOption ? `Сохранить и создать ${selectedOption.kind === "zip" ? "ZIP" : "PDF"}` : "Сохранить и создать"}
              </LoadingButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
