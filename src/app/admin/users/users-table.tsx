
'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import type { User as AppUser } from '@/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MoreHorizontal, Loader2, Database, PlayCircle, Phone, Mail, FilterX, Trash2, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { updateUser, adjustUserTokens, resetUserPassword, deleteUser, getAllUsers } from './actions';

export function UsersTable({ initialUsers }: { initialUsers: AppUser[] }) {
  const { toast } = useToast();
  const [users, setUsers] = useState(initialUsers);
  const [selectedUser, setSelectedUser] = useState<AppUser | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Dialog states
  const [isEditUserOpen, setIsEditUserOpen] = useState(false);
  const [isAdjustTokensOpen, setIsAdjustTokensOpen] = useState(false);
  const [isResetPasswordOpen, setIsResetPasswordOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  
  // Form input states
  const [currentName, setCurrentName] = useState('');
  const [currentEmail, setCurrentEmail] = useState('');
  const [currentPhone, setCurrentPhone] = useState('');
  const [currentRole, setCurrentRole] = useState<AppUser['role']>('User');
  const [currentFpsNames, setCurrentFpsNames] = useState('');
  const [tokenAdjustment, setTokenAdjustment] = useState(0);
  
  const [searchTerm, setSearchTerm] = useState('');

  // Sync state with props
  useEffect(() => {
    setUsers(initialUsers.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant')));
  }, [initialUsers]);

  const syncUsers = useCallback(async () => {
      setIsSyncing(true);
      toast({ title: '正在同步...', description: '正在從後端資料庫重新整理使用者資料。' });

      const result = await getAllUsers();
      if (result.success && result.users) {
          const freshUsers: AppUser[] = result.users;
          freshUsers.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
          setUsers(freshUsers);
          toast({ title: '同步成功', description: `已成功從資料庫載入 ${freshUsers.length} 位使用者。` });
      } else {
          toast({ 
              variant: 'destructive', 
              title: '同步失敗', 
              description: result.error || '無法從資料庫獲取最新資料。'
          });
      }
      setIsSyncing(false);
  }, [toast]);

  const handleOpenDialog = (user: AppUser, dialogSetter: React.Dispatch<React.SetStateAction<boolean>>) => {
    setSelectedUser(user);
    if (dialogSetter === setIsEditUserOpen) {
      setCurrentName(user.name);
      setCurrentEmail(user.email);
      setCurrentPhone(user.phone);
      setCurrentRole(user.role);
      setCurrentFpsNames(user.fpsPayerNames || '');
    }
    dialogSetter(true);
  };
  
  const handleSaveChanges = async () => {
    if (!selectedUser) return;
    setIsSubmitting(true);
    try {
      const updatedData = {
        name: currentName,
        email: currentEmail,
        phone: currentPhone,
        role: currentRole as AppUser['role'],
        fpsPayerNames: currentFpsNames,
      };

      const result = await updateUser(selectedUser.id, updatedData);

      if (result.success) {
        toast({ title: '成功', description: '使用者資料已更新。' });
        setUsers(prevUsers => {
          const updatedUsers = prevUsers.map(u => 
            u.id === selectedUser.id ? { ...u, ...updatedData } : u
          );
          return updatedUsers.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
        });
        setIsEditUserOpen(false);
      } else {
        throw new Error(result.error || '發生未知錯誤');
      }
    } catch (error: any) {
      toast({ variant: 'destructive', title: '錯誤', description: `更新失敗：${error.message}` });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTokenChange = async () => {
    if (!selectedUser) return;
    setIsSubmitting(true);
    const adjustment = Number(tokenAdjustment) || 0;
    try {
      const result = await adjustUserTokens(selectedUser.id, adjustment);
      if (result.success) {
        toast({ title: '成功', description: `餘額已調整。` });
        const newTokens = (selectedUser.tokens || 0) + adjustment;
        setUsers(prevUsers => prevUsers.map(u => 
            u.id === selectedUser.id ? { ...u, tokens: newTokens } : u
        ));
        
        try {
            const currentUserJSON = localStorage.getItem('user');
            if (currentUserJSON) {
                const currentUser = JSON.parse(currentUserJSON);
                if (currentUser.email === selectedUser.email) {
                    currentUser.tokens = newTokens;
                    localStorage.setItem('user', JSON.stringify(currentUser));
                    window.dispatchEvent(new Event('userUpdated'));
                }
            }
        } catch(error) {
            console.error("Failed to sync token update with localStorage", error);
        }

        setIsAdjustTokensOpen(false);
        setTokenAdjustment(0);
      } else {
        throw new Error(result.error || '發生未知錯誤');
      }
    } catch (error: any) {
      toast({ variant: 'destructive', title: '錯誤', description: `調整失敗：${error.message}` });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async () => {
    if (!selectedUser) return;
    setIsSubmitting(true);
    try {
      const result = await resetUserPassword(selectedUser.email);
      if (result.success) {
        toast({ title: '請求已送出', description: `已為 ${selectedUser.email} 觸發密碼重設流程。使用者將會收到一封郵件。` });
        setIsResetPasswordOpen(false);
      } else {
         throw new Error(result.error || '發生未知錯誤');
      }
    } catch (error: any) {
       toast({ variant: 'destructive', title: '錯誤', description: `請求失败：${error.message}` });
    } finally {
        setIsSubmitting(false);
    }
  };
  
  const handleDelete = async () => {
    if (!selectedUser) return;
    setIsSubmitting(true);
    
    const result = await deleteUser(selectedUser.id);

    if (result.success) {
      toast({ title: '刪除成功', description: `使用者 ${selectedUser.name} 已被永久刪除。` });
      setUsers(prevUsers => prevUsers.filter(u => u.id !== selectedUser.id));
      setIsDeleteDialogOpen(false);
    } else {
      toast({ variant: 'destructive', title: '刪除失敗', description: result.error });
    }
    
    setIsSubmitting(false);
  };

  const filteredUsers = useMemo(() => {
    return users.filter(user => {
      const term = searchTerm.toLowerCase();
      return (
        user.name.toLowerCase().includes(term) ||
        user.email.toLowerCase().includes(term) ||
        (user.phone && user.phone.toLowerCase().includes(term))
      );
    });
  }, [users, searchTerm]);

  const closeDialogs = () => {
    setSelectedUser(null);
    setTokenAdjustment(0);
  }

  if (users.length === 0) {
    return (
      <div className="text-center p-10">
          <Database className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-medium">找不到使用者資料</h3>
          <p className="mt-1 text-sm text-muted-foreground">
              資料庫中沒有任何使用者。
          </p>
      </div>
    );
  }

  return (
    <>
       <div className="p-4 border-b flex justify-between items-center">
        <Input
          placeholder="搜尋姓名、電郵或電話號碼..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="max-w-sm"
        />
        <Button variant="outline" onClick={() => syncUsers()} disabled={isSyncing}>
          {isSyncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          手動同步
        </Button>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[240px]">使用者</TableHead>
              <TableHead className="text-center">餘額 (HKD)</TableHead>
              <TableHead className="text-center">權限</TableHead>
              <TableHead>註冊日期</TableHead>
              <TableHead>
                <span className="sr-only">操作</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredUsers.length > 0 ? (
              filteredUsers.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  <div className="font-medium">{user.name}</div>
                  <div className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
                    <Mail className="h-3 w-3" />
                    {user.email}
                  </div>
                   <div className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
                     <Phone className="h-3 w-3" />
                     {user.phone}
                   </div>
                </TableCell>
                <TableCell className="text-center">{user.tokens}</TableCell>
                <TableCell className="text-center">
                  <Badge variant={
                      user.role === 'Admin' ? 'destructive' 
                    : user.role === 'VVIP' ? 'secondary' 
                    : user.role === 'VIP' ? 'secondary' 
                    : 'outline'
                  }>
                    {user.role}
                  </Badge>
                </TableCell>
                <TableCell>{user.joinedDate}</TableCell>
                <TableCell className="text-right">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button aria-haspopup="true" size="icon" variant="ghost">
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">切換選單</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-1">
                      <div className="flex flex-col text-sm">
                        <Button variant="ghost" className="justify-start px-2 py-1.5 h-auto" onClick={() => handleOpenDialog(user, setIsEditUserOpen)}>修改資料</Button>
                        <Button variant="ghost" className="justify-start px-2 py-1.5 h-auto" onClick={() => handleOpenDialog(user, setIsAdjustTokensOpen)}>調整餘額</Button>
                        <Button variant="ghost" className="justify-start px-2 py-1.5 h-auto" onClick={() => handleOpenDialog(user, setIsResetPasswordOpen)}>重設密碼</Button>
                        <div className="my-1 h-px bg-border" />
                        <Button variant="ghost" className="text-destructive hover:text-destructive justify-start px-2 py-1.5 h-auto" onClick={() => handleOpenDialog(user, setIsDeleteDialogOpen)}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            刪除使用者
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </TableCell>
              </TableRow>
            ))
            ) : (
                <TableRow>
                  <TableCell colSpan={5} className="h-48 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <FilterX className="h-8 w-8 text-muted-foreground" />
                      <p className="font-medium">找不到符合條件的使用者</p>
                      <p className="text-sm text-muted-foreground">請嘗試調整您的搜尋關鍵字。</p>
                    </div>
                  </TableCell>
                </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={isEditUserOpen} onOpenChange={(isOpen) => { setIsEditUserOpen(isOpen); if (!isOpen) closeDialogs(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>修改使用者資料</DialogTitle>
            <DialogDescription>在此修改 {selectedUser?.name} 的個人資料。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="name" className="text-right">姓名</Label>
              <Input id="name" value={currentName} onChange={(e) => setCurrentName(e.target.value)} className="col-span-3" />
            </div>
             <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="phone" className="text-right">電話</Label>
              <Input id="phone" value={currentPhone} onChange={(e) => setCurrentPhone(e.target.value)} className="col-span-3" />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="email" className="text-right">電郵</Label>
              <Input id="email" value={currentEmail} onChange={(e) => setCurrentEmail(e.target.value)} className="col-span-3" />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="fpsNames" className="text-right">FPS 付款人識別名稱</Label>
              <Input id="fpsNames" value={currentFpsNames} onChange={(e) => setCurrentFpsNames(e.target.value)} className="col-span-3" />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
               <div/>
               <p className="col-span-3 text-xs text-muted-foreground">用於自動核對 FPS 付款。可輸入多個名稱，以逗號 (,) 分隔。</p>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="role" className="text-right">權限</Label>
              <Select value={currentRole} onValueChange={(value) => setCurrentRole(value as AppUser['role'])}>
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder="選擇權限" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="User">User</SelectItem>
                  <SelectItem value="VIP">VIP</SelectItem>
                  <SelectItem value="VVIP">VVIP</SelectItem>
                  <SelectItem value="Admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" disabled={isSubmitting}>取消</Button></DialogClose>
            <Button onClick={handleSaveChanges} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              儲存變更
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isAdjustTokensOpen} onOpenChange={(isOpen) => { setIsAdjustTokensOpen(isOpen); if (!isOpen) closeDialogs(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>調整餘額</DialogTitle>
            <DialogDescription>為 {selectedUser?.name} 增加或減少餘額。目前擁有：HKD {selectedUser?.tokens}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="tokens" className="text-right">數量</Label>
              <Input
                id="tokens"
                type="number"
                value={tokenAdjustment}
                onChange={(e) => setTokenAdjustment(parseInt(e.target.value, 10) || 0)}
                className="col-span-3"
                placeholder="輸入正數增加，負數減少"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <div />
              <p className="col-span-3 text-sm text-muted-foreground">
                調整後總數：{selectedUser ? (selectedUser.tokens || 0) + (Number(tokenAdjustment) || 0) : 0}
              </p>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" disabled={isSubmitting}>取消</Button></DialogClose>
            <Button onClick={handleTokenChange} disabled={isSubmitting}>
               {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              確定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isResetPasswordOpen} onOpenChange={(isOpen) => { setIsResetPasswordOpen(isOpen); if (!isOpen) closeDialogs(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>確定要重設密碼嗎？</DialogTitle>
            <DialogDescription>此操作將會為使用者 {selectedUser?.email} 觸發密碼重設流程。此動作無法復原。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" disabled={isSubmitting}>取消</Button></DialogClose>
            <Button variant="destructive" onClick={handleResetPassword} disabled={isSubmitting}>
               {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              確定重設
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <Dialog open={isDeleteDialogOpen} onOpenChange={(isOpen) => { setIsDeleteDialogOpen(isOpen); if (!isOpen) closeDialogs(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>確定要永久刪除此使用者嗎？</DialogTitle>
            <DialogDescription>
                您正準備刪除使用者 <span className="font-semibold text-foreground">{selectedUser?.name} ({selectedUser?.email})</span>。此操作將同時從 Firebase Authentication 和 Firestore 資料庫中移除該使用者，且**無法復原**。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" disabled={isSubmitting}>取消</Button></DialogClose>
            <Button variant="destructive" onClick={handleDelete} disabled={isSubmitting}>
               {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              確定刪除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

    