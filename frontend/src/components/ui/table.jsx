import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * ⚠️ `wrapperClassName` VISE L'ENVELOPPE, ET C'EST ELLE QUI DÉFILE.
 *
 * shadcn enveloppe la table dans un `div overflow-auto` : c'est donc LUI le
 * conteneur de défilement, et un `<thead className="sticky top-0">` s'accroche à
 * lui, jamais à un parent posé plus haut. Sans moyen de le borner en hauteur,
 * l'en-tête collant d'un tableau long ne colle à rien — mesuré, il partait à
 * `top: -8956px`. Cette prop permet de lui donner sa hauteur (`h-full`), le
 * parent se chargeant de la borner.
 */
const Table = React.forwardRef(({ className, wrapperClassName, ...props }, ref) => (
  <div className={cn("relative w-full overflow-auto", wrapperClassName)}>
    <table
      ref={ref}
      className={cn("w-full caption-bottom text-sm", className)}
      {...props} />
  </div>
))
Table.displayName = "Table"

/*
 * ⚠️ LE GRIS FROID DES EN-TÊTES EST POSÉ ICI, une fois. Peint dans chaque
 * tableau, il aurait dérivé — et « tous les tableaux » en compte onze.
 */
const TableHeader = React.forwardRef(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn("bg-tableau-tete text-tableau-tete-foreground [&_tr]:border-b", className)}
    {...props} />
))
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child]:border-0", className)}
    {...props} />
))
TableBody.displayName = "TableBody"

const TableFooter = React.forwardRef(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)}
    {...props} />
))
TableFooter.displayName = "TableFooter"

const TableRow = React.forwardRef(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
      className
    )}
    {...props} />
))
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-10 px-2 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className
    )}
    {...props} />
))
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "p-2 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className
    )}
    {...props} />
))
TableCell.displayName = "TableCell"

const TableCaption = React.forwardRef(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-sm text-muted-foreground", className)}
    {...props} />
))
TableCaption.displayName = "TableCaption"

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
