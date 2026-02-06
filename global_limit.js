function checkGlobalLimit(memoryStats, settingsCache) {
    const globalSetting = settingsCache['__global_limit__'];
    if (!globalSetting) return { isOver: false, remaining: null, limit: null };

    const limitMinutes = globalSetting.limit;
    const limitSeconds = limitMinutes * 60;

    // Sum all tracked domains
    const totalSeconds = Object.values(memoryStats).reduce((sum, sec) => sum + sec, 0);

    return {
        isOver: totalSeconds > limitSeconds,
        remaining: Math.max(0, limitSeconds - totalSeconds),
        limit: limitSeconds,
        totalUsed: totalSeconds
    };
}
