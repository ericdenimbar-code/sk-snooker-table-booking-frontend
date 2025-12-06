'use client';

import React, { useState, useMemo, useEffect } from 'react';
import type { TokenPurchaseRequest } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MoreHorizontal, Loader2, Info, Mail, Phone, Hash, Eye, CircleDollarSign, Ban, FilterX } from "lucide-react";
import { approveTokenPurchaseRequest, cancelTokenPurchaseRequest } from './actions';
import { Skeleton } from '@/components/ui/skeleton';

type RequestsTableProps = {
    initialRequests: TokenPurchaseRequest[];
};

export function RequestsTable({ initialRequests }: RequestsTableProps) {
    const { toast } = useToast();
    const [requests, setRequests] = useState<TokenPurchaseRequest[]>(initialRequests);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('processing');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [selectedRequest, setSelectedRequest] = useState<TokenPurchaseRequest | null>(null);
    const [isApproveDialogOpen, setIsApproveDialogOpen] = useState(false);
    const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);
    const [isClient, setIsClient] = useState(false);

    useEffect(() => {
        setIsClient(true);
    }, []);

    // This useEffect will sync the component's state with the server-provided props.
    // This is crucial for when the page is revalidated and new data is fetched.
    useEffect(() => {
        setRequests(initialRequests);
    }, [initialRequests]);


    const handleOpenApproveDialog = (request: TokenPurchaseRequest) => {
        setSelectedRequest(request);
        setIsApproveDialogOpen(true);
    };
    
    const handleOpenCancelDialog = (request: TokenPurchaseRequest) => {
        setSelectedRequest(request);
        setIsCancelDialogOpen(true);
    };

    const handleApprove = async () => {
        if (!selectedRequest) return;
        setIsSubmitting(true);

        const result = await approveTokenPurchaseRequest(selectedRequest.id, selectedRequest.userEmail, selectedRequest.tokenQuantity);

        if (result.success) {
            toast({ title: '批核成功', description: `已為 ${selectedRequest.userEmail} 增加 HKD ${selectedRequest.tokenQuantity}。` });
            setRequests(prev => prev.map(req => 
                req.id === selectedRequest.id ? { ...req, status: 'completed', completionDate: new Date().toISOString() } : req
            ));
            setIsApproveDialogOpen(false);
        } else {
            toast({ variant: 'destructive', title: '批核失敗', description: result.error });
        }

        setIsSubmitting(false);
    };

    const handleCancel = async () => {
        if (!selectedRequest) return;
        setIsSubmitting(true);

        const result = await cancelTokenPurchaseRequest(selectedRequest.id);

        if (result.success) {
            toast({ title: '訂單已取消', description: `已取消請求 ${selectedRequest.id}。` });
            setRequests(prev => prev.map(req => 
                req.id === selectedRequest.id ? { ...req, status: 'cancelled' } : req
            ));
            setIsCancelDialogOpen(false);
        } else {
            toast({ variant: 'destructive', title: '取消失敗', description: result.error });
        }
        setIsSubmitting(false);
    };

    const handleViewProof = (request: TokenPurchaseRequest) => {
        if (!request.paymentProofUrl) return;

        try {
            const date = new Date(request.requestDate);
            const formattedDate = format(date, 'dd_MM_yyyy');
            const filename = `${request.userName}_${request.totalPriceHKD.toFixed(0)}_${formattedDate}_${request.id}.jpg`;

            const link = document.createElement('a');
            link.href = request.paymentProofUrl;
            link.download = filename;

            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (error) {
            toast({
                variant: 'destructive',
                title: '下載失败',
                description: '無法觸發檔案下載，請檢查瀏覽器權限。'
            });
            console.error("Failed to trigger download:", error);
        }
    };
    
    const clearFilters = () => {
        setSearchTerm('');
        setStatusFilter('all');
    };

    const filteredRequests = useMemo(() => {
        return requests.filter(req => {
            // Status filter
            if (statusFilter !== 'all' && req.status !== statusFilter) {
                return false;
            }

            // Search term filter
            if (searchTerm) {
                const term = searchTerm.toLowerCase();
                if (
                    !req.userName.toLowerCase().includes(term) &&
                    !req.userEmail.toLowerCase().includes(term) &&
                    !req.id.toLowerCase().includes(term) &&
                    !(req.userPhone && req.userPhone.includes(term))
                ) {
                    return false;
                }
            }

            return true;
        }).sort((a, b) => new Date(b.requestDate).getTime() - new Date(a.requestDate).getTime());
    }, [requests, searchTerm, statusFilter]);

    const renderEmptyState = () => {
        const isFiltering = searchTerm || statusFilter !== 'all';
        return (
            <TableRow>
                <TableCell colSpan={5} className="h-48 text-center">
                    <div className="flex flex-col items-center gap-2">
                        {isFiltering ? (
                            <>
                                <FilterX className="h-8 w-8 text-muted-foreground" />
                                <p className="font-medium">找不到符合條件的請求</p>
                                <p className="text-sm text-muted-foreground">請嘗試調整您的篩選條件。</p>
                            </>
                        ) : (
                            <>
                                <Info className="h-8 w-8 text-muted-foreground" />
                                <p className="font-medium">沒有增值請求</p>
                                <p className="text-sm text-muted-foreground">當使用者提交增值請求後，資料將會顯示於此。</p>
                            </>
                        )}
                    </div>
                </TableCell>
            </TableRow>
        );
    };

    return (
        <>
            <div className="flex items-center gap-2 flex-wrap p-1 mb-4">
                <Input
                    placeholder="搜尋 Ref No, 姓名, 電郵或電話..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="h-9 max-w-sm"
                />
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="h-9 w-[180px]">
                        <SelectValue placeholder="篩選狀態" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">所有狀態</SelectItem>
                        <SelectItem value="requesting">要求中</SelectItem>
                        <SelectItem value="processing">處理中</SelectItem>
                        <SelectItem value="completed">已完成</SelectItem>
                        <SelectItem value="cancelled">已取消</SelectItem>
                    </SelectContent>
                </Select>
                 <Button variant="ghost" onClick={clearFilters} className="h-9">
                    <FilterX className="mr-2 h-4 w-4"/>
                    清除
                </Button>
            </div>
            <div className="overflow-x-auto border rounded-lg">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="min-w-[220px]">使用者</TableHead>
                            <TableHead>請求詳情</TableHead>
                            <TableHead className="w-[120px]">狀態</TableHead>
                            <TableHead>請求日期</TableHead>
                            <TableHead className="text-right">操作</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredRequests.length > 0 ? filteredRequests.map(req => {
                            return (
                                <TableRow key={req.id}>
                                    <TableCell>
                                        <div className="font-medium">{req.userName}</div>
                                        <div className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
                                            <Mail className="h-3 w-3" />
                                            {req.userEmail}
                                        </div>
                                        <div className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
                                            <Phone className="h-3 w-3" />
                                            {req.userPhone || 'N/A'}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div>增值 <span className="font-semibold text-primary">{req.tokenQuantity}</span> 港幣</div>
                                        <div className="text-sm text-muted-foreground">HKD ${req.totalPriceHKD.toFixed(2)}</div>
                                        <div className="text-xs text-muted-foreground flex items-center gap-1.5 pt-1">
                                            <Hash className="h-3 w-3" /> {req.id}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        {(() => {
                                            switch (req.status) {
                                                case 'requesting':
                                                    return <Badge variant="outline" className="text-amber-600 border-amber-500">要求中</Badge>;
                                                case 'processing':
                                                    return <Badge className="bg-blue-600 text-primary-foreground hover:bg-blue-600/80 border-transparent">處理中</Badge>;
                                                case 'completed':
                                                    return <Badge className="bg-green-600 text-primary-foreground hover:bg-green-600/80 border-transparent">已完成</Badge>;
                                                case 'cancelled':
                                                    return <Badge variant="destructive">已取消</Badge>;
                                                default:
                                                    return <Badge variant="secondary">未知</Badge>;
                                            }
                                        })()}
                                    </TableCell>
                                    <TableCell>
                                      {isClient ? format(new Date(req.requestDate), 'yyyy-MM-dd HH:mm') : <Skeleton className="h-4 w-24" />}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <Button
                                                    aria-haspopup="true"
                                                    size="icon"
                                                    variant="ghost"
                                                    disabled={req.status === 'completed' || req.status === 'cancelled'}
                                                >
                                                    <MoreHorizontal className="h-4 w-4" />
                                                    <span className="sr-only">切換選單</span>
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-auto p-1">
                                                <div className="flex flex-col text-sm font-normal">
                                                     <Button
                                                        variant="ghost"
                                                        className="justify-start px-2 py-1.5 h-auto text-sm w-full"
                                                        disabled={!req.paymentProofUrl}
                                                        onClick={() => handleViewProof(req)}
                                                    >
                                                       <Eye className="mr-2 h-4 w-4" /> 入數記錄
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        className="justify-start px-2 py-1.5 h-auto text-sm"
                                                        disabled={req.status !== 'processing'}
                                                        onClick={() => handleOpenApproveDialog(req)}
                                                    >
                                                        <CircleDollarSign className="mr-2 h-4 w-4" /> 發放餘額
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        className="text-destructive hover:text-destructive justify-start px-2 py-1.5 h-auto text-sm"
                                                        onClick={() => handleOpenCancelDialog(req)}
                                                    >
                                                        <Ban className="mr-2 h-4 w-4" /> 取消訂單
                                                    </Button>
                                                </div>
                                            </PopoverContent>
                                        </Popover>
                                    </TableCell>
                                </TableRow>
                            )
                        }) : renderEmptyState()}
                    </TableBody>
                </Table>
            </div>
            
            <Dialog open={isApproveDialogOpen} onOpenChange={setIsApproveDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>確定要發放餘額嗎？</DialogTitle>
                        <DialogDescription>
                            此操作將會为使用者 <span className="font-semibold text-foreground">{selectedRequest?.userEmail}</span> 增加 <span className="font-semibold text-primary">HKD {selectedRequest?.tokenQuantity}</span> 的餘額，並且無法復原。
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <DialogClose asChild><Button variant="outline" disabled={isSubmitting}>取消</Button></DialogClose>
                        <Button onClick={handleApprove} disabled={isSubmitting}>
                            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            確定發放
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

             <Dialog open={isCancelDialogOpen} onOpenChange={setIsCancelDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>確定要取消此訂單嗎？</DialogTitle>
                        <DialogDescription>
                            您正要取消使用者 <span className="font-semibold text-foreground">{selectedRequest?.userEmail}</span> 的增值請求。此動作無法復原。
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <DialogClose asChild><Button variant="outline" disabled={isSubmitting}>返回</Button></DialogClose>
                        <Button variant="destructive" onClick={handleCancel} disabled={isSubmitting}>
                            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            確定取消訂單
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
