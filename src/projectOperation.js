// Owned above page navigation. Cancellation may lose to an already committed
// transaction, so keep project edits locked until its terminal result arrives.
export function createProjectOperationLock(onChange = () => {}) {
  let owner = null;
  return {
    isLocked: () => owner !== null,
    acquire() {
      if (owner) throw new Error('项目正在恢复，请等待当前操作结束。');
      const token = {}; owner = token; onChange(true);
      return () => {
        if (owner !== token) return;
        owner = null; onChange(false);
      };
    },
  };
}
