dependencies {
    intellijPlatform {
        bundledPlugin("org.jetbrains.plugins.terminal")
    }
    implementation(project(":frontend"))
    implementation(project(":shared"))
}

kotlin {
    jvmToolchain(25)
    compilerOptions.freeCompilerArgs.add("-jvm-default=no-compatibility")
    sourceSets["main"].kotlin.apply {
        srcDir(rootProject.layout.projectDirectory.dir("src/main/kotlin"))
        include("agentdock/acp/IdeTerminalBridgeImpl.kt")
    }
}

sourceSets["main"].resources.apply {
    srcDir(rootProject.layout.projectDirectory.dir("src/main/resources"))
    include("agent-dock.frontend-terminal.xml")
}
