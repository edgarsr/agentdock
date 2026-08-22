dependencies {
    intellijPlatform {
        bundledModule("intellij.platform.frontend")
        bundledModule("intellij.platform.vcs")
    }
    implementation(project(":frontend"))
    implementation(project(":shared"))
}

kotlin {
    jvmToolchain(21)
    compilerOptions.freeCompilerArgs.add("-Xjvm-default=all")
    sourceSets["main"].kotlin.apply {
        srcDir(rootProject.layout.projectDirectory.dir("src/main/kotlin"))
        include("agentdock/gitcommit/GenerateGitCommitMessageAction.kt")
    }
}

sourceSets["main"].resources.apply {
    srcDir(rootProject.layout.projectDirectory.dir("src/main/resources"))
    include("agent-dock.frontend-vcs.xml")
}
