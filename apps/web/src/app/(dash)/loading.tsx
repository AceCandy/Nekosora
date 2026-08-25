/** 设置与管理页导航取数期间的内容区骨架。 */
export default function DashLoading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center px-6" aria-hidden="true">
      <div className="w-full max-w-md animate-pulse space-y-2.5 motion-reduce:animate-none">
        <div className="h-3 w-3/4 rounded bg-morning-mist" />
        <div className="h-3 w-full rounded bg-morning-mist" />
        <div className="h-3 w-5/6 rounded bg-morning-mist" />
      </div>
    </div>
  );
}
